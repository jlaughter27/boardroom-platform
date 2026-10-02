import { Router } from 'express';
import type { IRouter } from 'express';
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
import { validateBody } from '../middleware/validate';
import { llmRateLimiter } from '../middleware/llm-rate-limiter';
import { toolRegistry } from '../tools';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';

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
function abortOnClose(req: AuthRequest): AbortSignal {
  const ac = new AbortController();
  req.on('close', () => ac.abort());
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
    const { question, mode } = req.body as { question: string; mode: UserMode; roomId?: string };

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
    createdAt: new Date().toISOString(),
  });
});

// GET /sessions -- list (returns recent from in-memory store)
router.get('/', (req: AuthRequest, res) => {
  const userId = req.auth!.userId;
  const userSessions = Array.from(sessions.values())
    .filter(s => s.userId === userId)
    .map(s => ({
      id: s.id,
      question: s.question,
      mode: s.mode,
      personaCount: s.personaResponses.size,
      hasSynthesis: s.synthesis !== null,
      createdAt: new Date().toISOString(),
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
    await orchestrator.dispatch(session, res, abortOnClose(req));
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
    await orchestrator.synthesize(session, res, abortOnClose(req));
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
    const client = new Anthropic({ apiKey });
    const score = await checkSufficiency(session.question, client, abortOnClose(req));
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
    const result = await orchestrator.runQuestionnaire(session, abortOnClose(req));
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
    const result = await orchestrator.runDoer(session, abortOnClose(req));
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
    const client = new Anthropic({ apiKey });

    const result = await proposeExtractions(session, client, abortOnClose(req));
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
