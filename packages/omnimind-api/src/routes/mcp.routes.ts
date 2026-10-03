import { Router, type IRouter, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { HttpError } from '../middleware/error-handler';
import { requireAdminKey, isAdminRequest } from '../middleware/admin-auth';

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

/**
 * F-206 / F-210 / O-105 — tenant scope for the MCP read endpoints.
 *
 *   agent context present → that tenant. A `?tenantId=` that disagrees is a
 *                           403 unless the caller is an admin (x-admin-key)
 *                           who passed `includeAllTenants=true`.
 *   no agent context      → `?tenantId=` if given; otherwise the caller MUST
 *                           opt in with `includeAllTenants=true` (never a
 *                           silent all-tenants default).
 * Returns null for "all tenants".
 */
function resolveMcpTenantScope(req: Request): string | null {
  const requested = typeof req.query.tenantId === 'string' && req.query.tenantId.length > 0
    ? req.query.tenantId
    : undefined;
  const includeAll =
    typeof req.query.includeAllTenants === 'string' &&
    req.query.includeAllTenants.toLowerCase() === 'true';
  const ctxTenant = req.agentContext?.tenantId;

  if (ctxTenant) {
    if (includeAll && isAdminRequest(req)) return requested ?? null;
    if (requested && requested !== ctxTenant) {
      throw new HttpError(403, {
        code: 'tenant_mismatch',
        message: `tenantId '${requested}' does not match the caller's tenant`,
      });
    }
    return ctxTenant;
  }

  if (requested) return requested;
  if (includeAll) return null;
  throw new HttpError(400, {
    code: 'tenant_scope_required',
    message: 'No agent context on this request; pass ?tenantId=<id> or opt into ?includeAllTenants=true',
  });
}

// POST /mcp/audit — write an audit log entry
router.post('/audit', async (req, res, next) => {
  try {
    const parsed = AuditLogSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }

    // M-103: a VERIFIED agent may only write audit rows for itself.
    const ctx = req.agentContext;
    if (ctx?.verified && (parsed.data.agentId !== ctx.agentId || parsed.data.tenantId !== ctx.tenantId)) {
      logger.warn('Audit write rejected: body identity disagrees with verified agent', {
        bodyAgentId: parsed.data.agentId,
        bodyTenantId: parsed.data.tenantId,
        agentId: ctx.agentId,
        tenantId: ctx.tenantId,
      });
      res.status(403).json({ error: 'audit_identity_mismatch', message: 'agentId/tenantId must match the verified agent' });
      return;
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
      res.status(201).json({ id: entry.id });
    } catch (err) {
      // F-106: an audit row that fails to persist is a forensic gap — log it
      // at error level WITH the agent + tool so it can be reconstructed.
      logger.error('Failed to write MCP audit log', {
        agentId: parsed.data.agentId,
        tenantId: parsed.data.tenantId,
        toolName: parsed.data.toolName,
        durationMs: parsed.data.durationMs,
        hadError: !!parsed.data.errorMessage,
        error: (err as Error).message,
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  } catch (err) { next(err); }
});

// GET /mcp/audit — list audit log entries (tenant-scoped, F-206)
router.get('/audit', async (req, res, next) => {
  try {
    const tenantId = resolveMcpTenantScope(req);
    const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
    const limitRaw = parseInt((req.query.limit as string) ?? '50', 10);
    const limit = Math.min(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 50, 200);

    const entries = await prisma.mcpAuditLog.findMany({
      where: {
        ...(agentId && { agentId }),
        ...(tenantId && { tenantId }),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    res.json({ entries, count: entries.length });
  } catch (err) { next(err); }
});

// POST /mcp/agents — register a new agent (keygen).
// F-104 / M-103: creating an identity row (tenant + scopes + weight) is an
// admin operation — it must not be possible with the shared service key alone.
router.post('/agents', requireAdminKey, async (req, res, next) => {
  try {
    const parsed = AgentCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
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
      logger.info('Agent registered', { agentId: agent.id, name: agent.name, tenantId: agent.tenantId });
      res.status(201).json({ id: agent.id, name: agent.name });
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('Unique constraint')) {
        res.status(409).json({ error: 'Agent name already registered' });
        return;
      }
      logger.error('Failed to register agent', { name: parsed.data.name, error: message });
      res.status(500).json({ error: 'Internal server error' });
    }
  } catch (err) { next(err); }
});

// GET /mcp/agents — list registered agents (tenant-scoped, F-206)
router.get('/agents', async (req, res, next) => {
  try {
    const tenantId = resolveMcpTenantScope(req);
    const agents = await prisma.agent.findMany({
      where: tenantId ? { tenantId } : {},
      select: { id: true, name: true, tenantId: true, scopes: true, sourceWeight: true, createdAt: true, lastSeenAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ agents, count: agents.length });
  } catch (err) { next(err); }
});

export default router;
