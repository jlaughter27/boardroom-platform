import { Router } from 'express';
import type { IRouter, Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { checkSessionLimit } from '../middleware/session-rate-limiter';
import { CEOOrchestrator } from '../agents/orchestrator';
import { DecisionSessionStore, SessionCapacityError, type StoredSession } from '../services/session-store';
import { logger } from '../lib/logger';
import { checkSufficiency } from '../agents/sufficiency';
import { omnimindClient } from '../services/omnimind-client';
import { proposeExtractions, confirmExtractions } from '../services/extraction.service';
import { exportSession } from '../services/export.service';
import { getPersonasForMode, shouldIncludeCEO } from '../personas/mode-router';
import type { PersonaId, UserMode, MemoryProposal, CustomPersona, DispatchSessionRequest } from '@boardroom/shared';
import { CreateSessionBodySchema, MemoryProposalSchema, DispatchSessionBodySchema, MODE_CONFIGS } from '@boardroom/shared';
import { DecideBodySchema, commitDecision, type DecideBody } from '../services/decision-commit.service';
import { validateBody } from '../middleware/validate';
import { llmRateLimiter } from '../middleware/llm-rate-limiter';
import { toolRegistry } from '../tools';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { createAnthropicClient } from '../lib/anthropic-client';

const router: IRouter = Router();
router.use(checkSessionLimit);

// RD-17 — sessions are persisted in OmniMind (`/decision-sessions`); this
// process keeps a cache. See services/session-store.ts for the write-through /
// load-on-miss / fallback rules. B-119: the cache's idle TTL counts from the
// LAST activity (every route that names a session touches it via `get`).
export const sessionStore = new DecisionSessionStore(omnimindClient, {
  // B-114: release the per-session tool invocation budget when a session leaves the cache.
  onEvict: (id) => toolRegistry.resetSession(id),
});

// Evict idle sessions from the cache every 5 minutes (persisted ones reload on demand).
const sweeper = setInterval(() => {
  sessionStore.sweep().catch((err) => logger.warn('[SessionStore] sweep failed', { message: err instanceof Error ? err.message : String(err) }));
}, 5 * 60 * 1000);
sweeper.unref?.();

/** The signed-in user's session (cache, else OmniMind) or a 404 response. */
async function ownedSession(req: AuthRequest, res: Response): Promise<StoredSession | null> {
  const session = await sessionStore.get(String(req.params.id), req.auth!.userId);
  if (!session) {
    res.status(404).json({ error: 'not_found', message: 'Session not found' });
    return null;
  }
  return session;
}

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

// POST /sessions -- create (RD-17: persisted in OmniMind; memory-only fallback)
router.post('/', validateBody(CreateSessionBodySchema), async (req: AuthRequest, res, next) => {
  try {
    const { question, mode, asOf } = req.body as { question: string; mode: UserMode; roomId?: string; asOf?: string };

    let session: StoredSession;
    try {
      session = await sessionStore.create(req.auth!.userId, { question, mode, ...(asOf ? { asOf } : {}) });
    } catch (err) {
      if (err instanceof SessionCapacityError) {
        res.status(503).json({ error: 'capacity_exceeded', message: 'Too many active sessions. Please try again later.' });
        return;
      }
      throw err;
    }

    res.status(201).json({
      sessionId: session.id,
      question,
      mode,
      personasToFire: getPersonasForMode(mode),
      includesCEO: shouldIncludeCEO(mode),
    });
  } catch (err) { next(err); }
});

// GET /sessions/:id
router.get('/:id', async (req: AuthRequest, res, next) => {
  try {
    const session = await ownedSession(req, res);
    if (!session) return;
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
  } catch (err) { next(err); }
});

const ListSessionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).catch(20),
  offset: z.coerce.number().int().min(0).catch(0),
});

// GET /sessions -- list, newest first (S-1: each row carries its REAL createdAt).
// RD-17: the page comes from OmniMind; memory-only sessions are listed first on page 1.
router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const { limit, offset } = ListSessionsQuerySchema.parse({ limit: req.query.limit ?? 20, offset: req.query.offset ?? 0 });
    res.json(await sessionStore.list(req.auth!.userId, limit, offset));
  } catch (err) { next(err); }
});

/**
 * M1-C2 — ids in a retry body that are not advisors of this session: not in the
 * mode's roster and not one of the user's active custom personas.
 */
async function unknownAdvisors(session: StoredSession, personaIds: string[]): Promise<string[]> {
  const roster = new Set<string>(MODE_CONFIGS[session.mode]?.personas ?? []);
  let unknown = personaIds.filter((id) => !roster.has(id));
  if (unknown.length > 0) {
    try {
      const custom = await omnimindClient.getCustomPersonas(session.userId) as CustomPersona[];
      const active = new Set(custom.filter((p) => p.isActive).map((p) => p.personaId));
      unknown = unknown.filter((id) => !active.has(id));
    } catch { /* custom personas unavailable: only the mode roster counts */ }
  }
  return unknown;
}

// POST /sessions/:id/dispatch -- fire personas (SSE).
// Body (optional): `{ personaIds }` re-runs only those advisors (Retry on a failed
// card) and never re-runs the debate round. Bad shape → 422 (validateBody); an id
// that is not an advisor of this session → 400 `unknown_persona`.
router.post('/:id/dispatch', validateBody(DispatchSessionBodySchema), llmRateLimiter, async (req: AuthRequest, res, next) => {
  try {
    const session = await ownedSession(req, res);
    if (!session) return;
    const { personaIds } = (req.body ?? {}) as DispatchSessionRequest;
    if (personaIds) {
      const unknown = await unknownAdvisors(session, personaIds);
      if (unknown.length > 0) {
        res.status(400).json({
          error: 'unknown_persona',
          message: `Not an advisor of this session: ${unknown.join(', ')}`,
          details: unknown.map((id) => ({ field: 'personaIds', message: `unknown persona '${id}'` })),
        });
        return;
      }
    }
    const orchestrator = getOrchestrator();
    // RD-17: persist once round 1 is on the session, and again at the end (rebuttals + ledger).
    const onRoundComplete = () => sessionStore.schedulePersist(session);
    try {
      await orchestrator.dispatch(session, res, abortOnClose(res), personaIds ? { personaIds, onRoundComplete } : { onRoundComplete });
    } finally {
      sessionStore.schedulePersist(session);
    }
  } catch (err) { next(err); }
});

// POST /sessions/:id/synthesize -- CEO synthesis (SSE)
router.post('/:id/synthesize', llmRateLimiter, async (req: AuthRequest, res, next) => {
  try {
    const session = await ownedSession(req, res);
    if (!session) return;
    // quick-take has no persona fan-out by design (B-112) — allow 0 responses there.
    if (session.personaResponses.size === 0 && session.mode !== 'quick-take') {
      res.status(400).json({ error: 'validation_failed', details: [{ field: 'session', message: 'Dispatch personas first' }] });
      return;
    }
    const orchestrator = getOrchestrator();
    try {
      await orchestrator.synthesize(session, res, abortOnClose(res));
    } finally {
      sessionStore.schedulePersist(session); // RD-17: CEO synthesis
    }
  } catch (err) { next(err); }
});

// POST /sessions/:id/check-ambiguity
router.post('/:id/check-ambiguity', llmRateLimiter, async (req: AuthRequest, res, next) => {
  try {
    const session = await ownedSession(req, res);
    if (!session) return;
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
    const session = await ownedSession(req, res);
    if (!session) return;
    const orchestrator = getOrchestrator();
    const result = await orchestrator.runQuestionnaire(session, abortOnClose(res));
    res.json(result);
  } catch (err) { next(err); }
});

// POST /sessions/:id/questionnaire/answers
router.post('/:id/questionnaire/answers', validateBody(QuestionnaireAnswersBodySchema), async (req: AuthRequest, res, next) => {
  try {
    const session = await ownedSession(req, res);
    if (!session) return;
    const { answers } = req.body as z.infer<typeof QuestionnaireAnswersBodySchema>;
    session.questionnaireAnswers = answers;
    const enrichment = answers.map(a => `Q: ${a.question}\nA: ${a.answer}`).join('\n');
    session.question = `${session.question}\n\n## Clarifications\n${enrichment}`;
    sessionStore.schedulePersist(session); // RD-17: the enriched question
    res.json({ enrichedContext: true, additionalContextItems: answers.length });
  } catch (err) { next(err); }
});

// POST /sessions/:id/plan -- doer mode
router.post('/:id/plan', llmRateLimiter, async (req: AuthRequest, res, next) => {
  try {
    const session = await ownedSession(req, res);
    if (!session) return;
    const orchestrator = getOrchestrator();
    const result = await orchestrator.runDoer(session, abortOnClose(res));
    res.json(result);
  } catch (err) { next(err); }
});

// POST /sessions/:id/extract-memories
router.post('/:id/extract-memories', llmRateLimiter, async (req: AuthRequest, res, next) => {
  try {
    const session = await ownedSession(req, res);
    if (!session) return;
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
    const session = await ownedSession(req, res);
    if (!session) return;
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
    const session = await ownedSession(req, res);
    if (!session) return;
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
    // RD-17: write the commit through now (no debounce); never blocks or fails the reply.
    void sessionStore.persistNow(session);
    res.status(201).json(decision);
  } catch (err) { next(err); }
});

// GET /sessions/:id/export
router.get('/:id/export', async (req: AuthRequest, res, next) => {
  try {
    const session = await ownedSession(req, res);
    if (!session) return;
    const format = (req.query.format as string) ?? 'json';
    if (format === 'pdf') {
      res.status(501).json({ error: 'not_implemented', message: 'PDF export coming in Phase 2' });
      return;
    }
    const exported = exportSession(session);
    res.json(exported);
  } catch (err) { next(err); }
});

export const sessionsRouter = router;
