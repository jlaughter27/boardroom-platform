import { Router, type IRouter } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';

const router: IRouter = Router();

const AuditLogSchema = z.object({
  agentId: z.string().min(1),
  tenantId: z.string().min(1),
  toolName: z.string().min(1),
  inputJson: z.unknown(),
  outputJson: z.unknown().optional(),
  errorMessage: z.string().optional(),
  durationMs: z.number().int().min(0),
});

const AgentCreateSchema = z.object({
  name: z.string().min(1),
  apiKeyHash: z.string().length(64),
  tenantId: z.string().min(1),
  scopes: z.array(z.string()).default([]),
  sourceWeight: z.number().min(0).max(2).default(1.0),
});

// POST /mcp/audit — write an audit log entry
router.post('/audit', async (req, res) => {
  const parsed = AuditLogSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }

  try {
    const entry = await prisma.mcpAuditLog.create({
      data: {
        agentId: parsed.data.agentId,
        tenantId: parsed.data.tenantId,
        toolName: parsed.data.toolName,
        inputJson: parsed.data.inputJson as object,
        outputJson: parsed.data.outputJson !== undefined ? parsed.data.outputJson as object : undefined,
        errorMessage: parsed.data.errorMessage,
        durationMs: parsed.data.durationMs,
      },
    });
    return res.status(201).json({ id: entry.id });
  } catch (err) {
    logger.error('Failed to write MCP audit log', { error: (err as Error).message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /mcp/audit — list audit log entries (admin use)
router.get('/audit', async (req, res) => {
  const agentId = req.query.agentId as string | undefined;
  const tenantId = req.query.tenantId as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string ?? '50', 10), 200);

  const entries = await prisma.mcpAuditLog.findMany({
    where: {
      ...(agentId && { agentId }),
      ...(tenantId && { tenantId }),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return res.json({ entries, count: entries.length });
});

// POST /mcp/agents — register a new agent (keygen)
router.post('/agents', async (req, res) => {
  const parsed = AgentCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }

  try {
    const agent = await prisma.agent.create({
      data: {
        name: parsed.data.name,
        apiKeyHash: parsed.data.apiKeyHash,
        tenantId: parsed.data.tenantId,
        scopes: parsed.data.scopes,
        sourceWeight: parsed.data.sourceWeight,
      },
    });
    return res.status(201).json({ id: agent.id, name: agent.name });
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes('Unique constraint')) {
      return res.status(409).json({ error: 'Agent name already registered' });
    }
    logger.error('Failed to register agent', { error: message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /mcp/agents — list registered agents
router.get('/agents', async (_req, res) => {
  const agents = await prisma.agent.findMany({
    select: { id: true, name: true, tenantId: true, scopes: true, sourceWeight: true, createdAt: true, lastSeenAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return res.json({ agents, count: agents.length });
});

export default router;
