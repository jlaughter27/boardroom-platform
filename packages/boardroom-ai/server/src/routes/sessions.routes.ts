import { Router } from 'express';
import type { IRouter } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { checkSessionLimit } from '../middleware/session-rate-limiter';
import { CEOOrchestrator, type SessionState } from '../agents/orchestrator';
import { checkSufficiency } from '../agents/sufficiency';
import { omnimindClient } from '../services/omnimind-client';
import { exportSession } from '../services/export.service';
import { getPersonasForMode, shouldIncludeCEO } from '../personas/mode-router';
import type { PersonaId, UserMode, PersonaResponse, SynthesisReport } from '@boardroom/shared';
import { CreateSessionBodySchema } from '@boardroom/shared';
import { validateBody } from '../middleware/validate';
import { logger } from '../lib/logger';
import Anthropic from '@anthropic-ai/sdk';

const router: IRouter = Router();
router.use(checkSessionLimit);

// In-memory write-through cache for ACTIVE sessions. OmniMind is the source of truth.
// We keep the cache so SSE handlers (dispatch/synthesize) don't pay HTTP latency mid-stream.
// On every state change (post-dispatch, post-synthesize, post-questionnaire) we flush to OmniMind.
const MAX_CACHED = 10000;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour idle eviction (data is durably persisted in OmniMind)

interface CachedSession extends SessionState {
  createdAt: Date;
  lastAccessedAt: number;
}

const cache = new Map<string, CachedSession>();

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of cache) {
    if (now - s.lastAccessedAt > CACHE_TTL_MS) cache.delete(id);
  }
}, 5 * 60 * 1000);

function getOrchestrator(): CEOOrchestrator {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  return new CEOOrchestrator(omnimindClient, apiKey);
}

function touch(session: CachedSession): CachedSession {
  session.lastAccessedAt = Date.now();
  return session;
}

function evictIfNeeded() {
  if (cache.size <= MAX_CACHED) return;
  let oldestId: string | null = null;
  let oldestT = Infinity;
  for (const [id, s] of cache) {
    if (s.lastAccessedAt < oldestT) { oldestT = s.lastAccessedAt; oldestId = id; }
  }
  if (oldestId) cache.delete(oldestId);
}

function serializeResponses(personaResponses: Map<PersonaId, PersonaResponse>): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of personaResponses) obj[k] = v;
  return obj;
}

function deserializeResponses(raw: unknown): Map<PersonaId, PersonaResponse> {
  const m = new Map<PersonaId, PersonaResponse>();
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      m.set(k as PersonaId, v as PersonaResponse);
    }
  }
  return m;
}

function parseSynthesis(raw: unknown): SynthesisReport | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as SynthesisReport; } catch { return null; }
  }
  return raw as SynthesisReport;
}

async function flushToOmniMind(session: CachedSession): Promise<void> {
  try {
    await omnimindClient.updateDecisionSession(session.userId, session.id, {
      question: session.question,
      mode: session.mode,
      personaResponses: serializeResponses(session.personaResponses),
      ceoSynthesis: session.synthesis,
    });
  } catch (err) {
    logger.warn('Failed to persist decision session to OmniMind', { sessionId: session.id, err: (err as Error).message });
  }
}

async function hydrateFromOmniMind(userId: string, id: string): Promise<CachedSession | null> {
  try {
    const remote = await omnimindClient.getDecisionSession(userId, id) as {
      id: string; userId: string; question: string; mode: string | null;
      personaResponses: Record<string, unknown>; ceoSynthesis: string | null;
      createdAt: string;
    } | null;
    if (!remote) return null;
    const hydrated: CachedSession = {
      id: remote.id,
      userId: remote.userId,
      question: remote.question,
      mode: (remote.mode ?? 'decide') as UserMode,
      personaResponses: deserializeResponses(remote.personaResponses),
      synthesis: parseSynthesis(remote.ceoSynthesis),
      createdAt: new Date(remote.createdAt),
      lastAccessedAt: Date.now(),
    };
    evictIfNeeded();
    cache.set(remote.id, hydrated);
    return hydrated;
  } catch (err) {
    logger.warn('Failed to hydrate decision session from OmniMind', { sessionId: id, err: (err as Error).message });
    return null;
  }
}

async function loadSession(userId: string, id: string): Promise<CachedSession | null> {
  const cached = cache.get(id);
  if (cached && cached.userId === userId) return touch(cached);
  return await hydrateFromOmniMind(userId, id);
}

// POST /sessions — create
router.post('/', validateBody(CreateSessionBodySchema), async (req: AuthRequest, res, next) => {
  try {
    const { question, mode, roomId } = req.body as { question: string; mode: UserMode; roomId?: string };

    // Persist to OmniMind first so we have a durable id + createdAt
    const remote = await omnimindClient.createDecisionSession(req.auth!.userId, {
      question,
      mode: mode as string,
      roomId: roomId ?? null,
    });

    const session: CachedSession = {
      id: remote.id,
      userId: req.auth!.userId,
      question,
      mode,
      personaResponses: new Map(),
      synthesis: null,
      createdAt: new Date(remote.createdAt),
      lastAccessedAt: Date.now(),
    };
    evictIfNeeded();
    cache.set(session.id, session);

    res.status(201).json({
      sessionId: session.id,
      question,
      mode,
      personasToFire: getPersonasForMode(mode),
      includesCEO: shouldIncludeCEO(mode),
      createdAt: session.createdAt.toISOString(),
    });
  } catch (err) { next(err); }
});

// GET /sessions/:id
router.get('/:id', async (req: AuthRequest, res, next) => {
  try {
    const session = await loadSession(req.auth!.userId, String(req.params.id));
    if (!session) {
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
      createdAt: session.createdAt.toISOString(),
    });
  } catch (err) { next(err); }
});

// GET /sessions — list (from OmniMind)
router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const userId = req.auth!.userId;
    const limit = req.query.limit ? Math.min(parseInt(String(req.query.limit), 10) || 20, 100) : 20;
    const offset = req.query.offset ? parseInt(String(req.query.offset), 10) || 0 : 0;

    const remote = await omnimindClient.listDecisionSessions(userId, limit, offset);
    const items = remote.items.map((s) => {
      const responses = s.personaResponses && typeof s.personaResponses === 'object'
        ? Object.keys(s.personaResponses).length
        : 0;
      return {
        id: s.id,
        question: s.question,
        mode: s.mode,
        personaCount: responses,
        hasSynthesis: s.ceoSynthesis !== null && s.ceoSynthesis !== undefined,
        createdAt: s.createdAt,
      };
    });
    res.json({ items, total: remote.total, offset: remote.offset, limit: remote.limit });
  } catch (err) { next(err); }
});

// POST /sessions/:id/dispatch — fire personas (SSE)
router.post('/:id/dispatch', async (req: AuthRequest, res, next) => {
  try {
    const session = await loadSession(req.auth!.userId, String(req.params.id));
    if (!session) {
      res.status(404).json({ error: 'not_found', message: 'Session not found' });
      return;
    }
    const orchestrator = getOrchestrator();
    await orchestrator.dispatch(session, res);
    void flushToOmniMind(session);
  } catch (err) { next(err); }
});

// POST /sessions/:id/synthesize — CEO synthesis (SSE)
router.post('/:id/synthesize', async (req: AuthRequest, res, next) => {
  try {
    const session = await loadSession(req.auth!.userId, String(req.params.id));
    if (!session) {
      res.status(404).json({ error: 'not_found', message: 'Session not found' });
      return;
    }
    if (session.personaResponses.size === 0) {
      res.status(400).json({ error: 'validation_failed', details: [{ field: 'session', message: 'Dispatch personas first' }] });
      return;
    }
    const orchestrator = getOrchestrator();
    await orchestrator.synthesize(session, res);
    void flushToOmniMind(session);
  } catch (err) { next(err); }
});

// POST /sessions/:id/check-ambiguity
router.post('/:id/check-ambiguity', async (req: AuthRequest, res, next) => {
  try {
    const session = await loadSession(req.auth!.userId, String(req.params.id));
    if (!session) {
      res.status(404).json({ error: 'not_found', message: 'Session not found' });
      return;
    }
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    const client = new Anthropic({ apiKey });
    const score = await checkSufficiency(session.question, client);
    res.json(score);
  } catch (err) { next(err); }
});

// NOTE (Wave 3 Track J orphan sweep, audit 01-feature-wiring.md):
//   POST /:id/questionnaire, /:id/questionnaire/answers, /:id/plan,
//   /:id/extract-memories, /:id/confirm-memories were deleted because no
//   client caller existed. The underlying CEOOrchestrator methods
//   (runQuestionnaire/runDoer) remain available for re-wiring when the
//   corresponding UI ships (filed in track-j-followups.md).

// GET /sessions/:id/export
router.get('/:id/export', async (req: AuthRequest, res, next) => {
  try {
    const session = await loadSession(req.auth!.userId, String(req.params.id));
    if (!session) {
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
  } catch (err) { next(err); }
});

export const sessionsRouter = router;
