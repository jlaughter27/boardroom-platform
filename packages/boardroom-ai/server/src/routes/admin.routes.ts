import { Router } from 'express';
import type { IRouter } from 'express';
import { omnimindClient } from '../services/omnimind-client';
import { requireAdmin } from '../middleware/require-admin';

const router: IRouter = Router();

// Gate every route in this router (ADM-01 / SEC-01 / F-003).
router.use(requireAdmin);

router.get('/stats', async (_req, res, next) => {
  try {
    const data = await omnimindClient.getAdminStats();
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/agents', async (_req, res, next) => {
  try {
    const data = await omnimindClient.getAdminAgents();
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/audit', async (req, res, next) => {
  try {
    const params: Record<string, string> = {};
    const { agentId, tenantId, toolName, limit, offset } = req.query as Record<string, string>;
    if (agentId) params.agentId = agentId;
    if (tenantId) params.tenantId = tenantId;
    if (toolName) params.toolName = toolName;
    if (limit) params.limit = limit;
    if (offset) params.offset = offset;
    const data = await omnimindClient.getAdminAudit(params);
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/memories', async (req, res, next) => {
  try {
    const params: Record<string, string> = {};
    const { agentId, tenantId, domain, sourceType, q, limit, offset } = req.query as Record<string, string>;
    if (agentId) params.agentId = agentId;
    if (tenantId) params.tenantId = tenantId;
    if (domain) params.domain = domain;
    if (sourceType) params.sourceType = sourceType;
    if (q) params.q = q;
    if (limit) params.limit = limit;
    if (offset) params.offset = offset;
    const data = await omnimindClient.getAdminMemories(params);
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/contradictions', async (req, res, next) => {
  try {
    const params: Record<string, string> = {};
    const { limit, offset } = req.query as Record<string, string>;
    if (limit) params.limit = limit;
    if (offset) params.offset = offset;
    const data = await omnimindClient.getAdminContradictions(params);
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/summarize', async (_req, res, next) => {
  try {
    const data = await omnimindClient.triggerAdminSummarize();
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/duplicates', async (req, res, next) => {
  try {
    const { threshold } = req.query as Record<string, string>;
    const params: Record<string, string> = {};
    if (threshold) params.threshold = threshold;
    const data = await omnimindClient.getAdminDuplicates(params);
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/duplicates/merge', async (req, res, next) => {
  try {
    const data = await omnimindClient.mergeAdminDuplicates(req.body);
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/decay/run', async (_req, res, next) => {
  try {
    const data = await omnimindClient.triggerAdminDecay();
    res.json(data);
  } catch (err) { next(err); }
});

export const adminRouter: IRouter = router;
