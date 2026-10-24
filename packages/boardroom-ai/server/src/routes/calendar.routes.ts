import { Router } from 'express';
import type { IRouter, Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth';
import * as calendarService from '../services/google-calendar.service';
import { verifyState } from '../services/google-calendar.service';
import { z } from 'zod';
import { MEETING_BRIEF_CONFIG } from '@boardroom/shared';
import type { CalendarEvent, MeetingBriefsResponse, PersonBriefsResponse } from '@boardroom/shared';
import { omnimindClient } from '../services/omnimind-client';
import { selectBriefableEvents, joinBriefs } from '../services/meeting-briefs';
import { logger } from '../lib/logger';

const router: IRouter = Router();

router.get('/status', async (req: AuthRequest, res, next) => {
  try {
    const status = await calendarService.getStatus(req.auth!.userId);
    res.json(status);
  } catch (err) { next(err); }
});

router.get('/auth-url', (req: AuthRequest, res) => {
  const url = calendarService.getAuthUrl(req.auth!.userId);
  if (!url) { res.json({ url: null, message: 'Google Calendar not configured' }); return; }
  res.json({ url });
});

// B-107 — exported so index.ts can register it directly before the auth wall
// (`app.get(path, router)` handed the router the unstripped URL → no match).
// Runs behind optionalAuthMiddleware: if a cookie IS present, the signed
// state's userId must match it.
export async function calendarCallback(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const code = req.query.code as string;
    const state = req.query.state as string;
    const userId = verifyState(state, 'calendar');
    if (!code || !userId) { res.status(400).send('Invalid or expired OAuth state'); return; }
    if (req.auth && req.auth.userId !== userId) { res.status(403).send('OAuth state does not match the signed-in user'); return; }
    await calendarService.handleCallback(userId, code);
    res.redirect('/settings?calendar=connected');
  } catch (err) { next(err); }
}
router.get('/callback', calendarCallback);

router.get('/events', async (req: AuthRequest, res, next) => {
  try {
    const start = req.query.start ? new Date(req.query.start as string) : new Date();
    const end = req.query.end ? new Date(req.query.end as string) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const events = await calendarService.getEvents(req.auth!.userId, start, end);
    res.json(events);
  } catch (err) { next(err); }
});

// RD-13 — GET /calendar/briefs?hours=1..48&refresh=1
// Meeting prep briefs for the next `hours` (default 24). Always HTTP 200 once
// the query validates: Google / OmniMind / contract failures answer
// `calendar: 'unavailable'`. Only attendee NAMES and normalized title tokens
// go to OmniMind; e-mails, raw titles and descriptions never leave BoardRoom,
// and logs carry counts only.
const BriefsQuerySchema = z.object({
  hours: z.coerce.number().int().min(1).max(MEETING_BRIEF_CONFIG.maxWindowHours).default(MEETING_BRIEF_CONFIG.windowHours),
  refresh: z.literal('1').optional(),
});

router.get('/briefs', async (req: AuthRequest, res) => {
  const parsed = BriefsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: 'validation_failed',
      details: parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })),
    });
    return;
  }
  const userId = req.auth!.userId;
  const now = new Date();
  const { hours, refresh } = parsed.data;
  const windowEnd = new Date(now.getTime() + hours * 3_600_000);
  const zeros = { noKnownPeople: 0, overCap: 0, allDayOrDeclined: 0 };
  const base = { generatedAt: now.toISOString(), windowEnd: windowEnd.toISOString() };
  const answer = (body: Omit<MeetingBriefsResponse, 'generatedAt' | 'windowEnd'>) => res.json({ ...base, ...body } satisfies MeetingBriefsResponse);

  if (!calendarService.isConfigured()) {
    answer({ calendar: 'not_configured', events: [], briefs: {}, omitted: zeros, partial: false });
    return;
  }

  let events: CalendarEvent[];
  try {
    const graceStart = new Date(now.getTime() - MEETING_BRIEF_CONFIG.inProgressGraceMin * 60_000);
    events = await calendarService.getEventsCached(userId, graceStart, windowEnd, { refresh: refresh === '1' });
  } catch (err) {
    if (err instanceof calendarService.CalendarNotConnectedError) {
      answer({ calendar: 'not_connected', events: [], briefs: {}, omitted: zeros, partial: false });
      return;
    }
    logger.warn('[calendar-briefs] calendar read failed', { userId, error: (err as Error)?.name ?? 'Error' });
    answer({ calendar: 'unavailable', events: [], briefs: {}, omitted: zeros, partial: false });
    return;
  }

  try {
    await buildBriefs(userId, events, now, hours, answer);
  } catch (err) {
    // Anything unexpected in select/join still answers (never a hung request).
    logger.error('[calendar-briefs] build failed', { userId, error: (err as Error)?.name ?? 'Error' });
    if (!res.headersSent) answer({ calendar: 'unavailable', events: [], briefs: {}, omitted: zeros, partial: false });
  }
});

async function buildBriefs(
  userId: string,
  events: CalendarEvent[],
  now: Date,
  hours: number,
  answer: (body: Omit<MeetingBriefsResponse, 'generatedAt' | 'windowEnd'>) => void,
): Promise<void> {
  const zeros = { noKnownPeople: 0, overCap: 0, allDayOrDeclined: 0 };
  const sel = selectBriefableEvents(events, now, hours);
  if (sel.attendeesPayload.length === 0 && sel.eventsPayload.length === 0) {
    answer({ calendar: 'connected', events: [], briefs: {}, omitted: { ...sel.omitted, noKnownPeople: sel.selected.length }, partial: false });
    return;
  }

  let response: PersonBriefsResponse;
  try {
    response = await omnimindClient.getPersonBriefs(userId, { attendees: sel.attendeesPayload, events: sel.eventsPayload });
  } catch (err) {
    logger.warn('[calendar-briefs] OmniMind briefs failed', { userId, error: (err as Error)?.name ?? 'Error', status: (err as { status?: number }).status });
    answer({ calendar: 'unavailable', events: [], briefs: {}, omitted: zeros, partial: false });
    return;
  }

  const joined = joinBriefs(sel.selected, sel.keyIndex, response);
  logger.info('[calendar-briefs] built', {
    userId,
    events: sel.selected.length,
    attendeesSent: sel.attendeesPayload.length,
    matched: response.attendeeMatches.filter(m => m.personId).length,
    titleMatched: response.titleMatches.length,
    ambiguous: response.attendeeMatches.filter(m => m.ambiguous).length,
    unknown: response.attendeeMatches.filter(m => !m.personId && !m.ambiguous).length,
    noKnownPeople: joined.noKnownPeople,
    smallTitledEvents: sel.eventsPayload.filter(e => e.smallMeeting).length,
  });
  if (response.partial && joined.events.length === 0) {
    // OmniMind could not resolve anyone (e.g. its people load failed) — saying
    // "no meetings with people you track" would be wrong, so offer Retry.
    answer({ calendar: 'unavailable', events: [], briefs: {}, omitted: zeros, partial: true });
    return;
  }
  answer({
    calendar: 'connected',
    events: joined.events,
    briefs: joined.briefs,
    omitted: { ...sel.omitted, noKnownPeople: joined.noKnownPeople },
    partial: response.partial,
  });
}

router.post('/disconnect', async (req: AuthRequest, res, next) => {
  try {
    await calendarService.disconnect(req.auth!.userId);
    res.json({ status: 'disconnected' });
  } catch (err) { next(err); }
});

export const calendarRouter = router;
