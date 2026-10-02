import { Router } from 'express';
import type { IRouter, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { requireSubscription } from '../middleware/subscription.middleware';
import { llmRateLimiter } from '../middleware/llm-rate-limiter';
import * as gmailService from '../services/gmail.service';
import * as calendarService from '../services/google-calendar.service';
import { verifyState } from '../services/google-calendar.service';
import { omnimindClient } from '../services/omnimind-client';

const router: IRouter = Router();

// List all integrations
router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const [gmail, calendarStatus] = await Promise.all([
      gmailService.getStatus(req.auth!.userId),
      calendarService.getStatus(req.auth!.userId),
    ]);
    res.json([
      { ...gmail, type: 'gmail' },
      { ...calendarStatus, type: 'google_calendar' },
    ]);
  } catch (err) { next(err); }
});

// Gmail OAuth
router.get('/gmail/auth-url', (req: AuthRequest, res) => {
  const url = gmailService.getAuthUrl(req.auth!.userId);
  if (!url) { res.json({ url: null, message: 'Gmail integration not configured' }); return; }
  res.json({ url });
});

// B-107 — exported so index.ts can register it directly before the auth wall.
// Runs behind optionalAuthMiddleware: if a cookie IS present, the signed
// state's userId must match it.
export async function gmailCallback(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const code = req.query.code as string;
    const state = req.query.state as string;
    const userId = verifyState(state, 'gmail');
    if (!code || !userId) { res.status(400).send('Invalid or expired OAuth state'); return; }
    if (req.auth && req.auth.userId !== userId) { res.status(403).send('OAuth state does not match the signed-in user'); return; }
    await gmailService.handleCallback(userId, code);
    res.redirect('/integrations?gmail=connected');
  } catch (err) { next(err); }
}
router.get('/gmail/callback', gmailCallback);

router.post('/gmail/disconnect', async (req: AuthRequest, res, next) => {
  try {
    await gmailService.disconnect(req.auth!.userId);
    res.json({ status: 'disconnected' });
  } catch (err) { next(err); }
});

// Gmail emails
router.get('/gmail/emails', async (req: AuthRequest, res, next) => {
  try {
    const emails = await gmailService.getRecentEmails(req.auth!.userId, 20);
    res.json(emails);
  } catch (err) { next(err); }
});

// B-113 — request body schemas (no shared schema exists for these two)
const GmailExtractBodySchema = z.object({
  emailId: z.string().min(1).max(200),
});

const GmailConfirmBodySchema = z.object({
  proposals: z.array(z.object({
    title: z.string().min(1).max(500),
    content: z.string().min(1).max(20000),
    domain: z.string().min(1).max(100).optional(),
    tags: z.array(z.string().max(100)).max(50).optional(),
    memoryClass: z.string().max(50).optional(),
    importance: z.number().min(0).max(1).optional(),
    emailId: z.string().max(200).optional(),
  })).max(100),
});

// Gmail extraction (LLM — B-110: subscription + per-user LLM limiter)
router.post('/gmail/extract', requireSubscription, llmRateLimiter, validateBody(GmailExtractBodySchema), async (req: AuthRequest, res, next) => {
  try {
    const { emailId } = req.body as z.infer<typeof GmailExtractBodySchema>;
    const extraction = await gmailService.extractMemoriesFromEmail(req.auth!.userId, emailId);
    res.json(extraction);
  } catch (err) { next(err); }
});

// Gmail confirm extraction (create memories)
router.post('/gmail/confirm', requireSubscription, validateBody(GmailConfirmBodySchema), async (req: AuthRequest, res, next) => {
  try {
    const { proposals } = req.body as z.infer<typeof GmailConfirmBodySchema>;
    let created = 0;
    for (const p of proposals) {
      await omnimindClient.createMemory(req.auth!.userId, {
        title: p.title,
        content: p.content,
        domain: p.domain ?? 'business',
        sourceType: 'API_IMPORT',
        tags: p.tags ?? [],
        memoryClass: p.memoryClass ?? 'SEMANTIC',
        importance: p.importance ?? 0.5,
        sourceRef: `gmail:${p.emailId ?? 'unknown'}`,
      });
      created++;
    }
    res.json({ created, rejected: 0 });
  } catch (err) { next(err); }
});

export const integrationsRouter = router;
