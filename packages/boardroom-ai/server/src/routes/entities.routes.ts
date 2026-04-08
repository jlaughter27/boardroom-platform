// Proxy routes for OmniMind entity CRUD
// BoardRoom client calls these; they forward to OmniMind with x-user-id

import { Router } from 'express';
import type { IRouter } from 'express';
import { z } from 'zod';
import type { AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { omnimindClient } from '../services/omnimind-client';

const UpdateProfileSchema = z.object({
  role: z.string().max(200).optional(),
  industry: z.string().max(200).optional(),
  decisionFrequency: z.string().max(100).optional(),
  riskProfile: z.object({
    financial: z.number().min(0).max(1),
    technical: z.number().min(0).max(1),
    people: z.number().min(0).max(1),
    strategic: z.number().min(0).max(1),
  }).optional(),
  valueHierarchy: z.array(z.string().max(200)).max(20).optional(),
  dashboardLayout: z.record(z.unknown()).optional(),
  onboardingComplete: z.boolean().optional(),
}).strict();

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

router.get('/goals', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.listGoals(req.auth!.userId);
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/goals', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.createGoal(req.auth!.userId, req.body);
    res.status(201).json(data);
  } catch (err) { next(err); }
});

router.patch('/goals/:id', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.updateGoal(req.auth!.userId, req.params.id, req.body);
    res.json(data);
  } catch (err) { next(err); }
});

router.delete('/goals/:id', async (req: AuthRequest, res, next) => {
  try {
    await omnimindClient.deleteGoal(req.auth!.userId, req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

router.get('/projects', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.listProjects(req.auth!.userId);
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/projects', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.createProject(req.auth!.userId, req.body);
    res.status(201).json(data);
  } catch (err) { next(err); }
});

router.patch('/projects/:id', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.updateProject(req.auth!.userId, req.params.id, req.body);
    res.json(data);
  } catch (err) { next(err); }
});

router.delete('/projects/:id', async (req: AuthRequest, res, next) => {
  try {
    await omnimindClient.deleteProject(req.auth!.userId, req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

router.get('/tasks', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.listTasks(req.auth!.userId);
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/tasks', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.createTask(req.auth!.userId, req.body);
    res.status(201).json(data);
  } catch (err) { next(err); }
});

router.patch('/tasks/:id', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.updateTask(req.auth!.userId, req.params.id, req.body);
    res.json(data);
  } catch (err) { next(err); }
});

router.delete('/tasks/:id', async (req: AuthRequest, res, next) => {
  try {
    await omnimindClient.deleteTask(req.auth!.userId, req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

router.get('/people', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.listPeople(req.auth!.userId);
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/people', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.createPerson(req.auth!.userId, req.body);
    res.status(201).json(data);
  } catch (err) { next(err); }
});

router.patch('/people/:id', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.updatePerson(req.auth!.userId, req.params.id, req.body);
    res.json(data);
  } catch (err) { next(err); }
});

router.delete('/people/:id', async (req: AuthRequest, res, next) => {
  try {
    await omnimindClient.deletePerson(req.auth!.userId, req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

router.get('/decisions', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.listDecisions(req.auth!.userId);
    res.json(data);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Commitments
// ---------------------------------------------------------------------------

router.get('/commitments', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.listCommitments(req.auth!.userId);
    res.json(data);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// User Profile
// ---------------------------------------------------------------------------

router.get('/profile', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.getUserProfile(req.auth!.userId);
    res.json(data);
  } catch (err) { next(err); }
});

router.patch('/profile', validateBody(UpdateProfileSchema), async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.updateUserProfile(req.auth!.userId, req.body);
    res.json(data);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Memories
// ---------------------------------------------------------------------------

router.get('/memories', async (req: AuthRequest, res, next) => {
  try {
    const qs = new URL(req.url, 'http://localhost').search.slice(1);
    const data = await omnimindClient.listMemories(req.auth!.userId, qs || undefined);
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/memories/search', async (req: AuthRequest, res, next) => {
  try {
    const q = req.query.q as string || '';
    const limit = parseInt(req.query.limit as string) || 20;
    const data = await omnimindClient.searchMemories(req.auth!.userId, q, limit);
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/memories/:id', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.getMemoryById(req.auth!.userId, req.params.id);
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/memories', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.createMemory(req.auth!.userId, req.body);
    res.status(201).json(data);
  } catch (err) { next(err); }
});

router.patch('/memories/:id', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.updateMemory(req.auth!.userId, req.params.id, req.body);
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/memories/:id/archive', async (req: AuthRequest, res, next) => {
  try {
    await omnimindClient.archiveMemory(req.auth!.userId, req.params.id);
    res.json({ status: 'ok' });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Outcome Reviews
// ---------------------------------------------------------------------------

router.get('/outcome-reviews', async (req: AuthRequest, res, next) => {
  try {
    const qs = new URL(req.url, 'http://localhost').search.slice(1);
    const filters = qs ? Object.fromEntries(new URLSearchParams(qs)) : undefined;
    const data = await omnimindClient.getOutcomeReviews(req.auth!.userId, filters);
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/outcome-reviews/pending', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.getPendingReviews(req.auth!.userId);
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/outcome-reviews/:id/complete', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.completeReview(req.auth!.userId, req.params.id, req.body);
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/outcome-reviews/:id/skip', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.skipReview(req.auth!.userId, req.params.id);
    res.json(data);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

router.get('/relationships/graph', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.getRelationshipGraph(req.auth!.userId);
    res.json(data);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Memory Entity Links
// ---------------------------------------------------------------------------

router.post('/memories/:id/links', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.createMemoryLink(req.auth!.userId, req.params.id, req.body);
    res.status(201).json(data);
  } catch (err) { next(err); }
});

router.get('/memories/:id/links', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.getMemoryLinks(req.auth!.userId, req.params.id);
    res.json(data);
  } catch (err) { next(err); }
});

router.delete('/memories/:id/links/:linkId', async (req: AuthRequest, res, next) => {
  try {
    await omnimindClient.deleteMemoryLink(req.auth!.userId, req.params.id, req.params.linkId);
    res.status(204).end();
  } catch (err) { next(err); }
});

export const entitiesRouter: IRouter = router;
