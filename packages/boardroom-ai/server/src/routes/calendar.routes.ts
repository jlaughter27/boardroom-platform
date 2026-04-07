import { Router } from 'express';
import type { IRouter } from 'express';
import type { AuthRequest } from '../middleware/auth';
import * as calendarService from '../services/google-calendar.service';

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

router.get('/callback', async (req, res, next) => {
  try {
    const code = req.query.code as string;
    const userId = req.query.state as string;
    if (!code || !userId) { res.status(400).send('Missing code or state'); return; }
    await calendarService.handleCallback(userId, code);
    res.redirect('/settings?calendar=connected');
  } catch (err) { next(err); }
});

router.get('/events', async (req: AuthRequest, res, next) => {
  try {
    const start = req.query.start ? new Date(req.query.start as string) : new Date();
    const end = req.query.end ? new Date(req.query.end as string) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const events = await calendarService.getEvents(req.auth!.userId, start, end);
    res.json(events);
  } catch (err) { next(err); }
});

router.post('/disconnect', async (req: AuthRequest, res, next) => {
  try {
    await calendarService.disconnect(req.auth!.userId);
    res.json({ status: 'disconnected' });
  } catch (err) { next(err); }
});

export const calendarRouter = router;
