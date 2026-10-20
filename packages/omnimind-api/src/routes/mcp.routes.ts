import { Router, type IRouter, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import {
  MCP_DELEGATE_SCOPE,
  McpAuditStatsQuerySchema,
  McpIdentityCreateRequestSchema,
  McpIdentityListQuerySchema,
  McpIdentityResolveRequestSchema,
  McpIdentityUpdateRequestSchema,
  McpTokenCreateRequestSchema,
  McpTokenIntrospectRequestSchema,
  McpTokenListQuerySchema,
} from '@boardroom/shared';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { HttpError } from '../middleware/error-handler';
import { requireAdminKey, isAdminRequest } from '../middleware/admin-auth';
import { DELEGATED_ROUTE_FORBIDDEN } from '../middleware/delegated-user-isolation';
import * as mcpTokens from '../services/mcp-token.service';

const router: IRouter = Router();

/**
 * Validation failures on `/mcp` stay 400 (the original convention of this
 * router) but carry the SAME body shape as the rest of the API's 422s
 * (`middleware/validate.ts`): `{ error: 'validation_failed', details: [{ field, message }] }`.
 * Review A7: BoardRoom's proxy no longer needs a second error parser.
 */
function validationFailed(res: Response, error: z.ZodError): void {
  res.status(400).json({
    error: 'validation_failed',
    details: error.issues.map(e => ({ field: e.path.join('.'), message: e.message })),
  });
}

/**
 * Token management (`/mcp/tokens*` create / list / options / revoke) is
 * BoardRoom-only: BoardRoom authenticates the user with its JWT and sends the
 * service key alone. Review A2: a read-only delegated principal could mint
 * itself a full-write token with its own userId. ANY agent context — verified,
 * legacy triple or delegated — is refused here, not just delegated ones
 * (delegated contexts are already stopped by the allow-list middleware).
 */
function requireNoAgentContext(req: Request, res: Response, next: NextFunction): void {
  const ctx = req.agentContext;
  if (ctx) {
    logger.warn('mcp: token-management route refused for an agent context', {
      path: req.path,
      method: req.method,
      agentId: ctx.agentId,
      delegated: ctx.delegated ?? false,
    });
    res.status(403).json({
      error: ctx.delegated ? DELEGATED_ROUTE_FORBIDDEN : 'agent_context_not_allowed',
      message: 'MCP token management is BoardRoom-only; agent identities (x-agent-key / x-agent-id / x-mcp-principal) may not manage tokens',
    });
    return;
  }
  next();
}

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
    if (!parsed.success) { validationFailed(res, parsed.error); return; }

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

// GET /mcp/audit — list audit log entries (tenant-scoped, F-206).
// Review A4: a DELEGATED principal sees only its own rows — `agentId` is
// forced to the principal's agentName; a disagreeing `?agentId=` is a 403.
router.get('/audit', async (req, res, next) => {
  try {
    const tenantId = resolveMcpTenantScope(req);
    const requestedAgentId = typeof req.query.agentId === 'string' && req.query.agentId.length > 0 ? req.query.agentId : undefined;
    const ctx = req.agentContext;
    if (ctx?.delegated && requestedAgentId && requestedAgentId !== ctx.agentId) {
      res.status(403).json({
        error: 'audit_identity_mismatch',
        message: 'A delegated principal may only read its own audit rows',
        agentId: ctx.agentId,
      });
      return;
    }
    const agentId = ctx?.delegated ? ctx.agentId : requestedAgentId;
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
    if (!parsed.success) { validationFailed(res, parsed.error); return; }

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

// GET /mcp/agents — list registered agents (tenant-scoped, F-206).
// Review A4: never for a delegated principal (agent roster = recon). The
// allow-list middleware already stops it; this is defence in depth.
router.get('/agents', async (req, res, next) => {
  try {
    if (req.agentContext?.delegated) {
      res.status(403).json({ error: DELEGATED_ROUTE_FORBIDDEN, message: 'GET /mcp/agents is not available to a delegated MCP principal' });
      return;
    }
    const tenantId = resolveMcpTenantScope(req);
    const agents = await prisma.agent.findMany({
      where: tenantId ? { tenantId } : {},
      select: { id: true, name: true, tenantId: true, scopes: true, sourceWeight: true, createdAt: true, lastSeenAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ agents, count: agents.length });
  } catch (err) { next(err); }
});

// ============================================================================
// Lane A1 (2026-10-18): per-user MCP tokens + OAuth identity resolution
// ============================================================================

/**
 * Gateway auth for introspect / resolve: the caller must be a VERIFIED agent
 * (x-agent-key) whose own row holds `mcp:delegate`, and must not itself be a
 * delegated context (a token can never introspect other tokens). The literal
 * scope is required — `*` does not imply it, so pre-existing wildcard agents
 * do not silently become gateways.
 */
function requireDelegateGateway(req: Request, res: Response, next: NextFunction): void {
  const ctx = req.agentContext;
  if (!ctx?.verified || ctx.delegated || !ctx.scopes?.includes(MCP_DELEGATE_SCOPE)) {
    logger.warn('mcp: gateway-only route refused', {
      path: req.path,
      agentId: ctx?.agentId ?? null,
      verified: ctx?.verified ?? false,
      delegated: ctx?.delegated ?? false,
    });
    res.status(403).json({
      error: 'gateway_scope_required',
      message: `This route requires a verified x-agent-key whose agent holds the '${MCP_DELEGATE_SCOPE}' scope`,
      required: MCP_DELEGATE_SCOPE,
    });
    return;
  }
  next();
}

// POST /mcp/tokens — mint a per-user token (raw value returned once).
// expiresInDays omitted → 365; null → never expires.
router.post('/tokens', requireNoAgentContext, async (req, res, next) => {
  try {
    const parsed = McpTokenCreateRequestSchema.safeParse(req.body);
    if (!parsed.success) { validationFailed(res, parsed.error); return; }
    const result = await mcpTokens.createMcpToken(parsed.data);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// GET /mcp/tokens/options?userId= — tenants the user owns + grantable scopes
// (declared before GET /tokens/:anything so the literal segment wins)
router.get('/tokens/options', requireNoAgentContext, async (req, res, next) => {
  try {
    const parsed = McpTokenListQuerySchema.safeParse(req.query);
    if (!parsed.success) { validationFailed(res, parsed.error); return; }
    res.json(await mcpTokens.getMcpTokenOptions(parsed.data.userId));
  } catch (err) { next(err); }
});

// GET /mcp/tokens?userId= — newest first; revoked > 30 days ago are hidden
router.get('/tokens', requireNoAgentContext, async (req, res, next) => {
  try {
    const parsed = McpTokenListQuerySchema.safeParse(req.query);
    if (!parsed.success) { validationFailed(res, parsed.error); return; }
    res.json({ tokens: await mcpTokens.listMcpTokens(parsed.data.userId) });
  } catch (err) { next(err); }
});

// POST /mcp/tokens/introspect — gateway only
router.post('/tokens/introspect', requireDelegateGateway, async (req, res, next) => {
  try {
    const parsed = McpTokenIntrospectRequestSchema.safeParse(req.body);
    if (!parsed.success) { validationFailed(res, parsed.error); return; }
    res.json(await mcpTokens.introspectMcpToken(parsed.data.token));
  } catch (err) { next(err); }
});

// DELETE /mcp/tokens/:id?userId= — revoke (204); 404 when not that user's
router.delete('/tokens/:id', requireNoAgentContext, async (req, res, next) => {
  try {
    const parsed = McpTokenListQuerySchema.safeParse(req.query);
    if (!parsed.success) { validationFailed(res, parsed.error); return; }
    const ok = await mcpTokens.revokeMcpToken(String(req.params.id), parsed.data.userId);
    if (!ok) {
      res.status(404).json({ error: 'not_found', message: 'Token not found' });
      return;
    }
    res.status(204).end();
  } catch (err) { next(err); }
});

// POST /mcp/identities/resolve — gateway only
router.post('/identities/resolve', requireDelegateGateway, async (req, res, next) => {
  try {
    const parsed = McpIdentityResolveRequestSchema.safeParse(req.body);
    if (!parsed.success) { validationFailed(res, parsed.error); return; }
    res.json(await mcpTokens.resolveMcpIdentity(parsed.data));
  } catch (err) { next(err); }
});

// ── OAuth identity administration (x-admin-key, review D/M6) ────────────────
// Auto-link picks the user's oldest owned tenant with read-only scopes; these
// routes let the operator link by hand, inspect, re-point / re-scope and
// revoke identities.

// POST /mcp/identities { issuer, subject, userId, tenantId, scopes?, sourceWeight?, clientId? }
// — link an (issuer, subject) pair when the IdP never sends a verified e-mail.
// 201 { identity } for a new row; 200 { identity } when a revoked row for the
// same pair was reactivated in place (the pair is unique regardless of revokedAt).
// 409 identity_exists { existingId } · 404 user_not_found · 403 tenant_not_owned
// · 403 issuer_not_allowed · 400 validation_failed.
router.post('/identities', requireAdminKey, async (req, res, next) => {
  try {
    const parsed = McpIdentityCreateRequestSchema.safeParse(req.body);
    if (!parsed.success) { validationFailed(res, parsed.error); return; }
    const result = await mcpTokens.createMcpIdentity(parsed.data);
    res.status(result.outcome === 'created' ? 201 : 200).json({ identity: result.identity });
  } catch (err) { next(err); }
});

// GET /mcp/identities[?userId=][&limit=50] — newest first, revoked included.
// Without userId: every identity (operator view), so an unlinked subject can
// be found after the warn line resolve writes for it. limit 1..200, default 50.
router.get('/identities', requireAdminKey, async (req, res, next) => {
  try {
    const parsed = McpIdentityListQuerySchema.safeParse(req.query);
    if (!parsed.success) { validationFailed(res, parsed.error); return; }
    res.json({ identities: await mcpTokens.listMcpIdentities(parsed.data) });
  } catch (err) { next(err); }
});

// PATCH /mcp/identities/:id { tenantId?, scopes? } — tenant must be owned by
// the identity's user (403 tenant_not_owned); scopes ⊆ MCP_SCOPES (400)
router.patch('/identities/:id', requireAdminKey, async (req, res, next) => {
  try {
    const parsed = McpIdentityUpdateRequestSchema.safeParse(req.body);
    if (!parsed.success) { validationFailed(res, parsed.error); return; }
    const updated = await mcpTokens.updateMcpIdentity(String(req.params.id), parsed.data);
    if (!updated) {
      res.status(404).json({ error: 'not_found', message: 'Identity not found' });
      return;
    }
    res.json(updated);
  } catch (err) { next(err); }
});

// DELETE /mcp/identities/:id — revoke (204, idempotent, evicts the delegation cache)
router.delete('/identities/:id', requireAdminKey, async (req, res, next) => {
  try {
    const ok = await mcpTokens.revokeMcpIdentity(String(req.params.id));
    if (!ok) {
      res.status(404).json({ error: 'not_found', message: 'Identity not found' });
      return;
    }
    res.status(204).end();
  } catch (err) { next(err); }
});

// GET /mcp/audit/stats?tool=&sinceHours=24 — latency percentiles + error rate.
// Tenant: agent context → its tenant (a disagreeing ?tenantId= is 403, same
// rule as GET /mcp/audit); no agent context → optional ?tenantId=, otherwise
// the aggregate spans all tenants (numbers only, nothing row-level).
router.get('/audit/stats', async (req, res, next) => {
  try {
    const parsed = McpAuditStatsQuerySchema.safeParse(req.query);
    if (!parsed.success) { validationFailed(res, parsed.error); return; }
    const ctxTenant = req.agentContext?.tenantId;
    let tenantId: string | undefined = parsed.data.tenantId;
    if (ctxTenant) {
      if (tenantId && tenantId !== ctxTenant && !isAdminRequest(req)) {
        throw new HttpError(403, {
          code: 'tenant_mismatch',
          message: `tenantId '${tenantId}' does not match the caller's tenant`,
        });
      }
      tenantId = tenantId ?? ctxTenant;
    }
    res.json(await mcpTokens.getMcpAuditStats({
      tool: parsed.data.tool,
      sinceHours: parsed.data.sinceHours,
      tenantId,
    }));
  } catch (err) { next(err); }
});

export default router;
