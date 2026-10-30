// RD-17 — /decision-sessions: persisted Decision Lab sessions (BoardRoom only).
// Contract: docs/contracts/omnimind-api.contract.md "Decision Sessions".

import { Router } from 'express';
import type { Router as IRouter, Request, Response, NextFunction } from 'express';
import {
  CreateDecisionSessionRequestSchema,
  UpdateDecisionSessionRequestSchema,
  ListDecisionSessionsQuerySchema,
  DECISION_SESSION_STATE_MAX_BYTES,
} from '@boardroom/shared';
import { prisma } from '../lib/db';
import * as service from '../services/decision-session.service';

const router: IRouter = Router();

const zodDetails = (issues: Array<{ path: PropertyKey[]; message: string }>) =>
  issues.map(i => ({ field: i.path.map(String).join('.'), message: i.message }));

/** x-user-id required; agent callers refused (BoardRoom-only resource). */
router.use((req: Request, res: Response, next: NextFunction) => {
  if (req.agentContext || req.headers['x-agent-id'] || req.headers['x-agent-key'] || req.headers['x-mcp-principal']) {
    res.status(403).json({ error: 'agent_context_unsupported', message: 'Decision Lab sessions are BoardRoom-only' });
    return;
  }
  const userId = req.headers['x-user-id'];
  if (typeof userId !== 'string' || userId.length === 0) {
    res.status(400).json({ error: 'validation_failed', details: [{ field: 'x-user-id', message: 'Missing x-user-id header' }] });
    return;
  }
  next();
});

const userOf = (req: Request): string => req.headers['x-user-id'] as string;

function tooLarge(res: Response): void {
  res.status(413).json({
    error: 'payload_too_large',
    message: `Session snapshot (personaResponses + state) exceeds ${DECISION_SESSION_STATE_MAX_BYTES} bytes`,
  });
}

const notFound = (res: Response): void => {
  res.status(404).json({ error: 'not_found', message: 'Decision session not found' });
};

// POST /decision-sessions
router.post('/', async (req, res, next) => {
  try {
    const parsed = CreateDecisionSessionRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(422).json({ error: 'validation_failed', details: zodDetails(parsed.error.issues) }); return; }
    if (service.snapshotTooLarge(parsed.data)) { tooLarge(res); return; }
    const record = await service.createDecisionSession(userOf(req), parsed.data, prisma);
    res.status(201).json(record);
  } catch (err) { next(err); }
});

// GET /decision-sessions?limit&offset
router.get('/', async (req, res, next) => {
  try {
    const parsed = ListDecisionSessionsQuerySchema.safeParse(req.query);
    if (!parsed.success) { res.status(422).json({ error: 'validation_failed', details: zodDetails(parsed.error.issues) }); return; }
    res.json(await service.listDecisionSessions(userOf(req), parsed.data, prisma));
  } catch (err) { next(err); }
});

// GET /decision-sessions/:id
router.get('/:id', async (req, res, next) => {
  try {
    const record = await service.getDecisionSession(userOf(req), req.params.id, prisma);
    if (!record) { notFound(res); return; }
    res.json(record);
  } catch (err) { next(err); }
});

// PATCH /decision-sessions/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const parsed = UpdateDecisionSessionRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(422).json({ error: 'validation_failed', details: zodDetails(parsed.error.issues) }); return; }
    if (service.snapshotTooLarge(parsed.data)) { tooLarge(res); return; }
    const record = await service.updateDecisionSession(userOf(req), req.params.id, parsed.data, prisma);
    if (!record) { notFound(res); return; }
    res.json(record);
  } catch (err) { next(err); }
});

// DELETE /decision-sessions/:id — archive (soft delete)
router.delete('/:id', async (req, res, next) => {
  try {
    const archived = await service.archiveDecisionSession(userOf(req), req.params.id, prisma);
    if (!archived) { notFound(res); return; }
    res.json({ id: req.params.id, status: 'archived' });
  } catch (err) { next(err); }
});

export const decisionSessionsRouter: IRouter = router;
