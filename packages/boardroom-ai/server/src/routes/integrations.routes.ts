import { Router } from 'express';
import type { IRouter } from 'express';
import type { AuthRequest } from '../middleware/auth';
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

router.get('/gmail/callback', async (req, res, next) => {
  try {
    const code = req.query.code as string;
    const state = req.query.state as string;
    const userId = verifyState(state, 'gmail');
    if (!code || !userId) { res.status(400).send('Invalid OAuth state'); return; }
    await gmailService.handleCallback(userId, code);
    res.redirect('/integrations?gmail=connected');
  } catch (err) { next(err); }
});

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

// Gmail extraction
router.post('/gmail/extract', async (req: AuthRequest, res, next) => {
  try {
    const { emailId } = req.body;
    if (!emailId) { res.status(422).json({ error: 'validation_failed', details: [{ field: 'emailId', message: 'Required' }] }); return; }
    const extraction = await gmailService.extractMemoriesFromEmail(req.auth!.userId, emailId);
    res.json(extraction);
  } catch (err) { next(err); }
});

// Gmail confirm extraction (create memories)
router.post('/gmail/confirm', async (req: AuthRequest, res, next) => {
  try {
    const { proposals } = req.body as { proposals: Array<{ title: string; content: string; domain?: string; tags?: string[]; memoryClass?: string; importance?: number; emailId?: string }> };
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
