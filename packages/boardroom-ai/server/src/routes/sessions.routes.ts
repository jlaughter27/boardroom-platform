import { Router } from 'express';
import type { IRouter, Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { checkSessionLimit } from '../middleware/session-rate-limiter';
import { CEOOrchestrator, type SessionState } from '../agents/orchestrator';
import { checkSufficiency } from '../agents/sufficiency';
import { omnimindClient } from '../services/omnimind-client';
import { proposeExtractions, confirmExtractions } from '../services/extraction.service';
import { exportSession } from '../services/export.service';
import { getPersonasForMode, shouldIncludeCEO } from '../personas/mode-router';
import type { PersonaId, UserMode, MemoryProposal } from '@boardroom/shared';
import { CreateSessionBodySchema, MemoryProposalSchema } from '@boardroom/shared';
import { DecideBodySchema, commitDecision, type DecideBody } from '../services/decision-commit.service';
import { validateBody } from '../middleware/validate';
import { llmRateLimiter } from '../middleware/llm-rate-limiter';
import { toolRegistry } from '../tools';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { createAnthropicClient } from '../lib/anthropic-client';

const router: IRouter = Router();
router.use(checkSessionLimit);

// In-memory session store (Phase 1 -- will persist to OmniMind later)
const MAX_SESSIONS = 10000;
// B-119: idle TTL — a session expires 30 minutes after its LAST activity, not
// its creation, so long deliberations no longer 404 mid-flow.
const SESSION_IDLE_TTL_MS = 30 * 60 * 1000;

interface StoredSession extends SessionState {
  createdAt: number;
  lastActivityAt: number;
  /**
   * R-B-06: set SYNCHRONOUSLY before the first `await` in POST /:id/decide so a
   * concurrent second commit is rejected while the first is still in flight
   * (`decisionId` is only known after OmniMind answers). Cleared on failure.
   */
  decisionPending?: boolean;
}

const sessions = new Map<string, StoredSession>();
let sessionCounter = 0;

function expireSession(id: string): void {
  sessions.delete(id);
  // B-114: release the per-session tool invocation budget when a session ends.
  toolRegistry.resetSession(id);
}

// Cleanup idle sessions every 5 minutes
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivityAt > SESSION_IDLE_TTL_MS) {
      expireSession(id);
    }
  }
}, 5 * 60 * 1000);
sweeper.unref?.();

// B-119: every route that names a session touches lastActivityAt.
router.param('id', (_req, _res, next, id) => {
  const session = sessions.get(String(id));
  if (session) session.lastActivityAt = Date.now();
  next();
});

// B-111: abort upstream LLM work when the client disconnects.
//
// R-B-01: listen on the RESPONSE, never on the request. On Node >= 16 an
// IncomingMessage emits `close` as soon as its body has been fully consumed —
// which express.json() does for every JSON POST before the handler runs — so a
// `req.on('close')` signal was already aborted before the first Anthropic call
// and every persona failed with "Request was aborted". `res.on('close')` fires
// when the underlying socket goes away; `writableFinished` distinguishes a
// normal end from a mid-stream disconnect.
export function abortOnClose(res: Response): AbortSignal {
  const ac = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) ac.abort();
  });
  return ac.signal;
}

// B-113 — request body schemas
const QuestionnaireAnswersBodySchema = z.object({
  answers: z.array(z.object({
    question: z.string().min(1).max(2000),
    answer: z.string().max(5000),
  })).max(50),
});

const ConfirmMemoriesBodySchema = z.object({
  accepted: z.array(z.number().int().min(0)).max(200).optional(),
  modified: z.array(z.object({
    index: z.number().int().min(0),
    changes: MemoryProposalSchema.partial(),
  })).max(200).optional(),
  rejected: z.array(z.number().int().min(0)).max(200).optional(),
});

function getOrchestrator(): CEOOrchestrator {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  return new CEOOrchestrator(omnimindClient, apiKey);
}

// POST /sessions -- create
router.post('/', validateBody(CreateSessionBodySchema), (req: AuthRequest, res, next) => {
  try {
    const { question, mode, asOf } = req.body as { question: string; mode: UserMode; roomId?: string; asOf?: string };

    if (sessions.size >= MAX_SESSIONS) {
      res.status(503).json({ error: 'capacity_exceeded', message: 'Too many active sessions. Please try again later.' });
      return;
    }

    const id = `session_${++sessionCounter}_${Date.now()}`;
    const now = Date.now();
    const session: StoredSession = {
      id,
      userId: req.auth!.userId,
      question,
      mode,
      personaResponses: new Map(),
      synthesis: null,
      createdAt: now,
      lastActivityAt: now,
      ...(asOf ? { asOf } : {}),
    };
    sessions.set(id, session);

    res.status(201).json({
      sessionId: id,
      question,
      mode,
      personasToFire: getPersonasForMode(mode),
      includesCEO: shouldIncludeCEO(mode),
    });
  } catch (err) { next(err); }
});

// GET /sessions/:id
router.get('/:id', (req: AuthRequest, res) => {
  const session = sessions.get(String(req.params.id));
  if (!session || session.userId !== req.auth!.userId) {
    res.status(404).json({ error: 'not_found', message: 'Session not found' });
    return;
  }
  res.json({
    id: session.id,
    question: session.question,
    mode: session.mode,
    personaResponses: Object.fromEntries(session.personaResponses),
    ceoSynthesis: session.synthesis,
    sufficiencyScore: null,
    createdAt: new Date(session.createdAt).toISOString(), // S-1: real creation time
    // Phase 6
    rebuttals: Object.fromEntries(session.rebuttals ?? []),
    ledger: session.ledger ?? [],
    decisionId: session.decisionId ?? null,
    asOf: session.asOf ?? null,
  });
});

// GET /sessions -- list (returns recent from in-memory store)
// S-1: each row carries the session's REAL createdAt and the list is newest
// first (it used to stamp `now` on every row, so the client could not order).
router.get('/', (req: AuthRequest, res) => {
  const userId = req.auth!.userId;
  const userSessions = Array.from(sessions.values())
    .filter(s => s.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(s => ({
      id: s.id,
      question: s.question,
      mode: s.mode,
      personaCount: s.personaResponses.size,
      hasSynthesis: s.synthesis !== null,
      createdAt: new Date(s.createdAt).toISOString(),
    }));
  res.json({ items: userSessions, total: userSessions.length, offset: 0, limit: 20 });
});

// POST /sessions/:id/dispatch -- fire personas (SSE)
router.post('/:id/dispatch', llmRateLimiter, async (req: AuthRequest, res, next) => {
  try {
    const session = sessions.get(String(req.params.id));
    if (!session || session.userId !== req.auth!.userId) {
      res.status(404).json({ error: 'not_found', message: 'Session not found' });
      return;
    }
    const orchestrator = getOrchestrator();
    await orchestrator.dispatch(session, res, abortOnClose(res));
  } catch (err) { next(err); }
});

// POST /sessions/:id/synthesize -- CEO synthesis (SSE)
router.post('/:id/synthesize', llmRateLimiter, async (req: AuthRequest, res, next) => {
  try {
    const session = sessions.get(String(req.params.id));
    if (!session || session.userId !== req.auth!.userId) {
      res.status(404).json({ error: 'not_found', message: 'Session not found' });
      return;
    }
    // quick-take has no persona fan-out by design (B-112) — allow 0 responses there.
    if (session.personaResponses.size === 0 && session.mode !== 'quick-take') {
      res.status(400).json({ error: 'validation_failed', details: [{ field: 'session', message: 'Dispatch personas first' }] });
      return;
    }
    const orchestrator = getOrchestrator();
    await orchestrator.synthesize(session, res, abortOnClose(res));
  } catch (err) { next(err); }
});

// POST /sessions/:id/check-ambiguity
router.post('/:id/check-ambiguity', llmRateLimiter, async (req: AuthRequest, res, next) => {
  try {
    const session = sessions.get(String(req.params.id));
    if (!session || session.userId !== req.auth!.userId) {
      res.status(404).json({ error: 'not_found', message: 'Session not found' });
      return;
    }
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    const client = createAnthropicClient(apiKey);
    const score = await checkSufficiency(session.question, client, abortOnClose(res), { sessionId: session.id, userId: session.userId });
    res.json(score);
  } catch (err) { next(err); }
});

// POST /sessions/:id/questionnaire
router.post('/:id/questionnaire', llmRateLimiter, async (req: AuthRequest, res, next) => {
  try {
    const session = sessions.get(String(req.params.id));
    if (!session || session.userId !== req.auth!.userId) {
      res.status(404).json({ error: 'not_found', message: 'Session not found' });
      return;
    }
    const orchestrator = getOrchestrator();
    const result = await orchestrator.runQuestionnaire(session, abortOnClose(res));
    res.json(result);
  } catch (err) { next(err); }
});

// POST /sessions/:id/questionnaire/answers
router.post('/:id/questionnaire/answers', validateBody(QuestionnaireAnswersBodySchema), (req: AuthRequest, res) => {
  const session = sessions.get(String(req.params.id));
  if (!session || session.userId !== req.auth!.userId) {
    res.status(404).json({ error: 'not_found', message: 'Session not found' });
    return;
  }
  const { answers } = req.body as z.infer<typeof QuestionnaireAnswersBodySchema>;
  session.questionnaireAnswers = answers;
  const enrichment = answers.map(a => `Q: ${a.question}\nA: ${a.answer}`).join('\n');
  session.question = `${session.question}\n\n## Clarifications\n${enrichment}`;
  res.json({ enrichedContext: true, additionalContextItems: answers.length });
});

// POST /sessions/:id/plan -- doer mode
router.post('/:id/plan', llmRateLimiter, async (req: AuthRequest, res, next) => {
  try {
    const session = sessions.get(String(req.params.id));
    if (!session || session.userId !== req.auth!.userId) {
      res.status(404).json({ error: 'not_found', message: 'Session not found' });
      return;
    }
    const orchestrator = getOrchestrator();
    const result = await orchestrator.runDoer(session, abortOnClose(res));
    res.json(result);
  } catch (err) { next(err); }
});

// POST /sessions/:id/extract-memories
router.post('/:id/extract-memories', llmRateLimiter, async (req: AuthRequest, res, next) => {
  try {
    const session = sessions.get(req.params.id);
    if (!session || session.userId !== req.auth!.userId) {
      res.status(404).json({ error: 'not_found', message: 'Session not found' });
      return;
    }
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    const client = createAnthropicClient(apiKey);

    const result = await proposeExtractions(session, client, abortOnClose(res));
    res.json(result);
  } catch (err) { next(err); }
});

// POST /sessions/:id/confirm-memories
router.post('/:id/confirm-memories', validateBody(ConfirmMemoriesBodySchema), async (req: AuthRequest, res, next) => {
  try {
    const session = sessions.get(req.params.id);
    if (!session || session.userId !== req.auth!.userId) {
      res.status(404).json({ error: 'not_found', message: 'Session not found' });
      return;
    }
    const { accepted, modified, rejected } = req.body as {
      accepted?: number[];
      modified?: { index: number; changes: Partial<MemoryProposal> }[];
      rejected?: number[];
    };
    const result = await confirmExtractions(
      session.id, req.auth!.userId, accepted ?? [], modified ?? [], rejected ?? [], omnimindClient
    );
    res.json(result);
  } catch (err) { next(err); }
});

// POST /sessions/:id/decide — Phase 6 decision commit.
// Body: { chosenPath, rationale?, expectedOutcome, probabilitySuccess (0..1), reviewAt? }
// → 201 Decision (OmniMind row) with personaForecasts (revised when a rebuttal
// happened), assumptions from the CEO report, mode from the session, decidedAt now.
router.post('/:id/decide', validateBody(DecideBodySchema), async (req: AuthRequest, res, next) => {
  try {
    const session = sessions.get(String(req.params.id));
    if (!session || session.userId !== req.auth!.userId) {
      res.status(404).json({ error: 'not_found', message: 'Session not found' });
      return;
    }
    if (session.decisionId) {
      res.status(409).json({ error: 'already_decided', message: 'This session already committed a decision', decisionId: session.decisionId });
      return;
    }
    // R-B-06: the check above is not atomic across the `await` below — two
    // concurrent commits both saw `decisionId` unset and both created a
    // Decision. Mark the session synchronously before awaiting; the second
    // request is rejected while the first is in flight.
    if (session.decisionPending) {
      res.status(409).json({ error: 'decision_pending', message: 'A decision commit for this session is already in progress' });
      return;
    }
    session.decisionPending = true;
    let decision;
    try {
      decision = await commitDecision(session, req.body as DecideBody, omnimindClient);
    } catch (err) {
      session.decisionPending = false; // allow a retry after an upstream failure
      throw err;
    }
    session.decisionPending = false;
    session.decisionId = decision.id; // commitDecision sets it too; make the invariant explicit here
    res.status(201).json(decision);
  } catch (err) { next(err); }
});

// GET /sessions/:id/export
router.get('/:id/export', (req: AuthRequest, res) => {
  const session = sessions.get(req.params.id);
  if (!session || session.userId !== req.auth!.userId) {
    res.status(404).json({ error: 'not_found', message: 'Session not found' });
    return;
  }
  const format = (req.query.format as string) ?? 'json';
  if (format === 'pdf') {
    res.status(501).json({ error: 'not_implemented', message: 'PDF export coming in Phase 2' });
    return;
  }
  const exported = exportSession(session);
  res.json(exported);
});

export const sessionsRouter = router;
