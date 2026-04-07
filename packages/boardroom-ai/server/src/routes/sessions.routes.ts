import { Router } from 'express';
import type { IRouter } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { CEOOrchestrator, type SessionState } from '../agents/orchestrator';
import { checkSufficiency } from '../agents/sufficiency';
import { omnimindClient } from '../services/omnimind-client';
import { proposeExtractions, confirmExtractions } from '../services/extraction.service';
import { exportSession } from '../services/export.service';
import { getPersonasForMode, shouldIncludeCEO } from '../personas/mode-router';
import type { PersonaId, UserMode, MemoryProposal } from '@boardroom/shared';
import Anthropic from '@anthropic-ai/sdk';

const router: IRouter = Router();

// In-memory session store (Phase 1 -- will persist to OmniMind later)
const sessions = new Map<string, SessionState>();
let sessionCounter = 0;

function getOrchestrator(): CEOOrchestrator {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  return new CEOOrchestrator(omnimindClient, apiKey);
}

// POST /sessions -- create
router.post('/', (req: AuthRequest, res, next) => {
  try {
    const { question, mode } = req.body as { question: string; mode: UserMode; roomId?: string };
    if (!question || !mode) {
      res.status(422).json({ error: 'validation_failed', details: [{ field: 'body', message: 'question and mode required' }] });
      return;
    }

    const id = `session_${++sessionCounter}_${Date.now()}`;
    const session: SessionState = {
      id,
      userId: req.auth!.userId,
      question,
      mode,
      personaResponses: new Map(),
      synthesis: null,
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
router.post('/:id/dispatch', async (req: AuthRequest, res, next) => {
  try {
    const session = sessions.get(String(req.params.id));
    if (!session || session.userId !== req.auth!.userId) {
      res.status(404).json({ error: 'not_found', message: 'Session not found' });
      return;
    }
    const orchestrator = getOrchestrator();
    await orchestrator.dispatch(session, res);
  } catch (err) { next(err); }
});

// POST /sessions/:id/synthesize -- CEO synthesis (SSE)
router.post('/:id/synthesize', async (req: AuthRequest, res, next) => {
  try {
    const session = sessions.get(String(req.params.id));
    if (!session || session.userId !== req.auth!.userId) {
      res.status(404).json({ error: 'not_found', message: 'Session not found' });
      return;
    }
    if (session.personaResponses.size === 0) {
      res.status(400).json({ error: 'validation_failed', details: [{ field: 'session', message: 'Dispatch personas first' }] });
      return;
    }
    const orchestrator = getOrchestrator();
    await orchestrator.synthesize(session, res);
  } catch (err) { next(err); }
});

// POST /sessions/:id/check-ambiguity
router.post('/:id/check-ambiguity', async (req: AuthRequest, res, next) => {
  try {
    const session = sessions.get(String(req.params.id));
    if (!session || session.userId !== req.auth!.userId) {
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

// POST /sessions/:id/questionnaire
router.post('/:id/questionnaire', async (req: AuthRequest, res, next) => {
  try {
    const session = sessions.get(String(req.params.id));
    if (!session || session.userId !== req.auth!.userId) {
      res.status(404).json({ error: 'not_found', message: 'Session not found' });
      return;
    }
    const orchestrator = getOrchestrator();
    const result = await orchestrator.runQuestionnaire(session);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /sessions/:id/questionnaire/answers
router.post('/:id/questionnaire/answers', (req: AuthRequest, res) => {
  const session = sessions.get(String(req.params.id));
  if (!session || session.userId !== req.auth!.userId) {
    res.status(404).json({ error: 'not_found', message: 'Session not found' });
    return;
  }
  const { answers } = req.body as { answers: { question: string; answer: string }[] };
  session.questionnaireAnswers = answers;
  const enrichment = answers.map(a => `Q: ${a.question}\nA: ${a.answer}`).join('\n');
  session.question = `${session.question}\n\n## Clarifications\n${enrichment}`;
  res.json({ enrichedContext: true, additionalContextItems: answers.length });
});

// POST /sessions/:id/plan -- doer mode
router.post('/:id/plan', async (req: AuthRequest, res, next) => {
  try {
    const session = sessions.get(String(req.params.id));
    if (!session || session.userId !== req.auth!.userId) {
      res.status(404).json({ error: 'not_found', message: 'Session not found' });
      return;
    }
    const orchestrator = getOrchestrator();
    const result = await orchestrator.runDoer(session);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /sessions/:id/extract-memories
router.post('/:id/extract-memories', async (req: AuthRequest, res, next) => {
  try {
    const session = sessions.get(req.params.id);
    if (!session || session.userId !== req.auth!.userId) {
      res.status(404).json({ error: 'not_found', message: 'Session not found' });
      return;
    }
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    const client = new Anthropic({ apiKey });

    const result = await proposeExtractions(session, client);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /sessions/:id/confirm-memories
router.post('/:id/confirm-memories', async (req: AuthRequest, res, next) => {
  try {
    const session = sessions.get(req.params.id);
    if (!session || session.userId !== req.auth!.userId) {
      res.status(404).json({ error: 'not_found', message: 'Session not found' });
      return;
    }
    const { accepted, modified, rejected } = req.body as {
      accepted: number[];
      modified: { index: number; changes: Partial<MemoryProposal> }[];
      rejected: number[];
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
