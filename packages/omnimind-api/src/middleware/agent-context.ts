/**
 * agent-context middleware
 *
 * Resolves the calling agent's identity and attaches it to `req.agentContext`
 * for route handlers and the service layer.
 *
 * AUDIT-2026-10-02 / M-103 — identity is now VERIFIABLE:
 *
 *   1. `x-agent-key: omk_...` (preferred). The raw key is sha256-hashed and
 *      looked up in `agents.api_key_hash`. No match → 401. On a match the
 *      agentId / tenantId / scopes / sourceWeight come FROM THE AGENT ROW.
 *      Any `x-agent-id` / `x-tenant-id` / `x-source-weight` header that
 *      disagrees with the row → 403. `lastSeenAt` is touched at most once per
 *      5 minutes per agent. The context is marked `verified: true` and the
 *      scope-enforcer middleware applies `Agent.scopes` server-side.
 *
 *   2. Legacy header fast-path (solo mode): `x-agent-id` + `x-tenant-id` +
 *      `x-source-weight` with NO `x-agent-key` are trusted as-is, with a
 *      warn logged once per agent id. Set `OMNIMIND_REQUIRE_AGENT_KEY=true`
 *      to turn this path off (→ 401 when `x-agent-id` arrives without a key).
 *      A PARTIAL triple (x-agent-id without x-tenant-id / x-source-weight) is
 *      refused with 400 `partial_agent_identity` — it never falls through to
 *      the unscoped path (E2E-5).
 *
 *   3. No agent headers at all (BoardRoom AI, internal jobs): `agentContext`
 *      stays undefined and services fall back to their defaults.
 *
 * The old "look up Agent by sha256(x-api-key)" fallback is gone: the MCP
 * server never sent an `omk_` key as `x-api-key`, so it could never match,
 * and it cost a DB round-trip on every BoardRoom request.
 *
 * F-217 — `x-source-weight` must be a plain decimal in [0, 2]; anything else
 * (hex, exponent notation, out of range, NaN) is a 400, never clamped.
 *
 * Lane A1 (2026-10-18) — DELEGATED identity (per-user MCP tokens / OAuth):
 *
 *   4. A VERIFIED agent whose row holds the `mcp:delegate` scope (an MCP
 *      gateway) may add `x-mcp-principal: token:<tokenId>` or
 *      `oauth:<identityId>`. The McpToken / McpOauthIdentity row is loaded
 *      (60 s in-memory cache, evicted on revoke) and the context becomes that
 *      principal: `agentId = row.agentName`, `tenantId = row.tenantId`,
 *      `sourceWeight = row.sourceWeight`, `scopes = row.scopes ∩
 *      (gateway.scopes − mcp:delegate)`, `verified: true, delegated: true,
 *      userId: row.userId`. Revoked / expired / unknown principal → 401
 *      `principal_invalid`. `x-mcp-principal` from anyone that is not a
 *      verified `mcp:delegate` agent → 403 `delegation_not_allowed`.
 *      `delegated-user-isolation.ts` (mounted right after this middleware)
 *      pins the request's userId to the principal's user.
 *
 * IMPORTANT: This middleware MUST be wired AFTER `apiKeyAuth` in `index.ts`.
 */

import type { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { MCP_DELEGATE_SCOPE, MCP_PRINCIPAL_HEADER } from '@boardroom/shared';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { loadDelegatedPrincipal } from '../services/mcp-token.service';

export interface AgentContext {
  agentId: string;
  tenantId: string;
  sourceWeight: number;
  /** Scopes from the Agent row. Only present when `verified` is true. */
  scopes?: string[];
  /** true when identity was verified against agents.api_key_hash via x-agent-key. */
  verified?: boolean;
  /**
   * true when a gateway agent (scope `mcp:delegate`) is acting as a per-user
   * principal via `x-mcp-principal`. `agentId` is then the principal's
   * agentName, and `userId` the user it belongs to.
   */
  delegated?: boolean;
  /** The delegated principal's user. Only present when `delegated` is true. */
  userId?: string;
}

// TypeScript declaration merging — extend Express.Request with `agentContext`.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      agentContext?: AgentContext;
    }
  }
}

const LAST_SEEN_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const lastSeenTouchedAt = new Map<string, number>();
const legacyWarned = new Set<string>();

export function __resetAgentContextStateForTest(): void {
  lastSeenTouchedAt.clear();
  legacyWarned.clear();
}

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

const SOURCE_WEIGHT_RE = /^\d+(\.\d+)?$/;

export type SourceWeightParse =
  | { ok: true; value: number | null }
  | { ok: false; reason: string };

/** F-217: strict parse. Absent/empty → null. Malformed or out of range → error (400). */
export function parseSourceWeight(raw: unknown): SourceWeightParse {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (typeof s !== 'string') return { ok: false, reason: 'x-source-weight must be a single header value' };
  const trimmed = s.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (!SOURCE_WEIGHT_RE.test(trimmed)) {
    return { ok: false, reason: 'x-source-weight must be a plain decimal number (e.g. "1.0")' };
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > 2) {
    return { ok: false, reason: 'x-source-weight must be within [0, 2]' };
  }
  return { ok: true, value: n };
}

function readHeader(req: Request, name: string): string | null {
  const v = req.headers[name];
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requireAgentKey(): boolean {
  return (process.env.OMNIMIND_REQUIRE_AGENT_KEY ?? '').trim().toLowerCase() === 'true';
}

/**
 * Lane A1: scopes the delegated context may use — every principal scope that
 * the gateway itself holds, once `mcp:delegate` is removed from the gateway's
 * list. `*` / `<prefix>:*` on the gateway side are honoured; the result is
 * always a flat list of concrete scopes.
 */
export function intersectDelegatedScopes(principalScopes: readonly string[], gatewayScopes: readonly string[]): string[] {
  const gateway = gatewayScopes.filter(s => s !== MCP_DELEGATE_SCOPE);
  const hasGatewayScope = (required: string): boolean => {
    if (gateway.includes('*')) return true;
    if (gateway.includes(required)) return true;
    const [prefix] = required.split(':');
    return gateway.includes(`${prefix}:*`);
  };
  return principalScopes.filter(s => s !== MCP_DELEGATE_SCOPE && hasGatewayScope(s));
}

function touchLastSeen(agentRowId: string): void {
  const now = Date.now();
  const last = lastSeenTouchedAt.get(agentRowId) ?? 0;
  if (now - last < LAST_SEEN_TOUCH_INTERVAL_MS) return;
  lastSeenTouchedAt.set(agentRowId, now);
  void prisma.agent
    .update({ where: { id: agentRowId }, data: { lastSeenAt: new Date(now) } })
    .catch(err => {
      logger.warn('agent-context: lastSeenAt update failed', { agentRowId, err: (err as Error).message });
    });
}

export async function agentContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Skip context attachment for health checks — no auth, no work.
  if (req.path === '/health') {
    next();
    return;
  }

  try {
    const headerAgentId = readHeader(req, 'x-agent-id');
    const headerTenantId = readHeader(req, 'x-tenant-id');
    const parsedWeight = parseSourceWeight(req.headers['x-source-weight']);
    if (!parsedWeight.ok) {
      res.status(400).json({ error: 'invalid_source_weight', message: parsedWeight.reason });
      return;
    }
    const headerSourceWeight = parsedWeight.value;
    const agentKey = readHeader(req, 'x-agent-key');
    const principalRef = readHeader(req, MCP_PRINCIPAL_HEADER);

    // ── Path 1: verified identity via x-agent-key ────────────────────────
    if (agentKey) {
      let agent: Awaited<ReturnType<typeof prisma.agent.findFirst>>;
      try {
        agent = await prisma.agent.findFirst({ where: { apiKeyHash: hashApiKey(agentKey) } });
      } catch (err) {
        // Fail CLOSED: a request that asserted an identity must not proceed
        // unscoped because the lookup failed.
        logger.error('agent-context: agent lookup failed', { err: (err as Error).message });
        res.status(503).json({ error: 'agent_lookup_failed', message: 'Agent identity could not be verified' });
        return;
      }

      if (!agent) {
        logger.warn('agent-context: unknown x-agent-key', { headerAgentId, path: req.path, ip: req.ip });
        res.status(401).json({ error: 'invalid_agent_key', message: 'x-agent-key does not match any registered agent' });
        return;
      }

      // ── Path 4: delegated principal (Lane A1) ──────────────────────────
      let delegated: { agentId: string; tenantId: string; sourceWeight: number; scopes: string[]; userId: string; rowId: string } | null = null;
      if (principalRef) {
        if (!agent.scopes.includes(MCP_DELEGATE_SCOPE)) {
          logger.warn('agent-context: x-mcp-principal from an agent without mcp:delegate', { agent: agent.name, path: req.path });
          res.status(403).json({
            error: 'delegation_not_allowed',
            message: `Agent '${agent.name}' does not hold the '${MCP_DELEGATE_SCOPE}' scope and may not present x-mcp-principal`,
          });
          return;
        }
        let loaded: Awaited<ReturnType<typeof loadDelegatedPrincipal>>;
        try {
          loaded = await loadDelegatedPrincipal(principalRef);
        } catch (err) {
          logger.error('agent-context: principal lookup failed', { err: (err as Error).message });
          res.status(503).json({ error: 'agent_lookup_failed', message: 'Delegated principal could not be verified' });
          return;
        }
        if (!loaded.ok) {
          logger.warn('agent-context: x-mcp-principal refused', { agent: agent.name, reason: loaded.reason, path: req.path });
          res.status(401).json({
            error: 'principal_invalid',
            message: `x-mcp-principal is ${loaded.reason === 'not_found' ? 'unknown' : loaded.reason}`,
            reason: loaded.reason,
          });
          return;
        }
        delegated = {
          agentId: loaded.principal.agentName,
          tenantId: loaded.principal.tenantId,
          sourceWeight: loaded.principal.sourceWeight,
          scopes: intersectDelegatedScopes(loaded.principal.scopes, agent.scopes),
          userId: loaded.principal.userId,
          rowId: loaded.principal.id,
        };
      }

      // Legacy headers must agree with the registered agent — or, when
      // delegating, with the principal the gateway is acting as.
      const mismatches: string[] = [];
      const agentIdOk = (v: string) => v === agent.name || v === agent.id || (delegated !== null && (v === delegated.agentId || v === delegated.rowId));
      const tenantOk = (v: string) => v === agent.tenantId || (delegated !== null && v === delegated.tenantId);
      const weightOk = (v: number) => v === agent.sourceWeight || (delegated !== null && v === delegated.sourceWeight);
      if (headerAgentId && !agentIdOk(headerAgentId)) mismatches.push('x-agent-id');
      if (headerTenantId && !tenantOk(headerTenantId)) mismatches.push('x-tenant-id');
      if (headerSourceWeight !== null && !weightOk(headerSourceWeight)) mismatches.push('x-source-weight');
      if (mismatches.length > 0) {
        logger.warn('agent-context: headers disagree with registered agent', {
          agent: agent.name,
          mismatches,
          headerAgentId,
          headerTenantId,
          headerSourceWeight,
        });
        res.status(403).json({
          error: 'agent_header_mismatch',
          message: `Request headers disagree with the registered agent: ${mismatches.join(', ')}`,
          fields: mismatches,
        });
        return;
      }

      if (delegated) {
        req.agentContext = {
          agentId: delegated.agentId,
          tenantId: delegated.tenantId,
          sourceWeight: delegated.sourceWeight,
          scopes: delegated.scopes,
          verified: true,
          delegated: true,
          userId: delegated.userId,
        };
      } else {
        req.agentContext = {
          agentId: agent.name,
          tenantId: agent.tenantId,
          sourceWeight: agent.sourceWeight,
          scopes: agent.scopes,
          verified: true,
        };
      }
      touchLastSeen(agent.id);
      next();
      return;
    }

    // Lane A1: nobody but a verified mcp:delegate gateway may present a principal.
    if (principalRef) {
      logger.warn('agent-context: x-mcp-principal without a verified x-agent-key', { headerAgentId, path: req.path, ip: req.ip });
      res.status(403).json({
        error: 'delegation_not_allowed',
        message: 'x-mcp-principal requires a verified x-agent-key whose agent holds the mcp:delegate scope',
      });
      return;
    }

    // ── Path 2: legacy header identity (solo mode) ───────────────────────
    if (headerAgentId) {
      if (requireAgentKey()) {
        logger.warn('agent-context: x-agent-id without x-agent-key refused (OMNIMIND_REQUIRE_AGENT_KEY=true)', {
          agentId: headerAgentId,
          path: req.path,
        });
        res.status(401).json({
          error: 'agent_key_required',
          message: 'OMNIMIND_REQUIRE_AGENT_KEY is enabled: send the agent\'s omk_ key in x-agent-key',
        });
        return;
      }

      if (headerTenantId && headerSourceWeight !== null) {
        if (!legacyWarned.has(headerAgentId)) {
          legacyWarned.add(headerAgentId);
          logger.warn('agent-context: unverified legacy header identity (no x-agent-key) — trusting headers (solo mode)', {
            agentId: headerAgentId,
            tenantId: headerTenantId,
          });
        }
        req.agentContext = {
          agentId: headerAgentId,
          tenantId: headerTenantId,
          sourceWeight: headerSourceWeight,
          verified: false,
        };
      } else {
        // Fail CLOSED (E2E-5): an asserted agent identity with a missing tenant
        // or weight must not fall through to the unscoped BoardRoom path, or a
        // mis-configured agent reads across every tenant of the user. BoardRoom
        // AI never sends agent headers and the MCP server always sends the
        // full triple (or an omk_ key), so nothing legitimate lands here.
        logger.warn('agent-context: partial agent headers refused (need x-agent-key, or x-agent-id + x-tenant-id + x-source-weight)', {
          agentId: headerAgentId,
          hasTenant: !!headerTenantId,
          hasSourceWeight: headerSourceWeight !== null,
          path: req.path,
        });
        res.status(400).json({
          error: 'partial_agent_identity',
          message: 'x-agent-id must be accompanied by x-tenant-id and x-source-weight (or send the agent\'s omk_ key in x-agent-key)',
          fields: [
            ...(headerTenantId ? [] : ['x-tenant-id']),
            ...(headerSourceWeight !== null ? [] : ['x-source-weight']),
          ],
        });
        return;
      }
    }

    // ── Path 3: no agent identity → BoardRoom AI / internal caller ───────
    next();
  } catch (err) {
    logger.error('agent-context: unexpected error', { err: (err as Error).message });
    next(err);
  }
}
