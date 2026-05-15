/**
 * agent-context middleware
 *
 * Extracts agent identity from the request and attaches it to `req.agentContext`
 * for downstream route handlers and the service layer.
 *
 * Sources (in priority order):
 *   1. Request headers (`x-agent-id`, `x-tenant-id`, `x-source-weight`) — preferred
 *   2. Agent row lookup by `apiKeyHash(x-api-key)` — fallback when headers absent
 *
 * If neither is available, `req.agentContext` is left undefined and routes
 * that need it must default sensibly (we never block requests here — auth
 * has already happened upstream, and BoardRoom AI calls won't carry these
 * headers).
 *
 * IMPORTANT: This middleware MUST be wired AFTER `apiKeyAuth` in `index.ts`.
 */

import type { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';

export interface AgentContext {
  agentId: string;
  tenantId: string;
  sourceWeight: number;
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

function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

function parseSourceWeight(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (typeof s !== 'string') return null;
  // F-217: gate the input with a strict decimal regex before Number(). Without
  // this, scientific-notation ("1e308") and hex ("0xFF") inputs parsed cleanly
  // and were then clamped to 2 — effectively letting a hostile header bump the
  // caller above all other agents in the sourceWeight ranking tiebreaker.
  if (!/^\d+(\.\d+)?$/.test(s.trim())) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  // Clamp to [0, 2] — the schema allows arbitrary floats but anything outside
  // this range is almost certainly a bug or an injection attempt.
  return Math.max(0, Math.min(2, n));
}

function readHeader(req: Request, name: string): string | null {
  const v = req.headers[name];
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function agentContextMiddleware(
  req: Request,
  _res: Response,
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
    const headerSourceWeight = parseSourceWeight(req.headers['x-source-weight']);

    // Fast path: all three headers present — trust and attach.
    if (headerAgentId && headerTenantId && headerSourceWeight !== null) {
      req.agentContext = {
        agentId: headerAgentId,
        tenantId: headerTenantId,
        sourceWeight: headerSourceWeight,
      };
      next();
      return;
    }

    // Fallback: at least one header missing — try Agent lookup by API key hash.
    const apiKey = readHeader(req, 'x-api-key');
    if (apiKey) {
      const apiKeyHash = hashApiKey(apiKey);
      const agent = await prisma.agent
        .findFirst({ where: { apiKeyHash } })
        .catch(err => {
          // Agent table may not exist yet in tests, or Prisma client may be stale.
          // Don't block the request — just skip context attachment.
          logger.warn('agent-context: lookup failed', { err: (err as Error).message });
          return null;
        });

      if (agent) {
        req.agentContext = {
          agentId: headerAgentId ?? agent.id,
          tenantId: headerTenantId ?? agent.tenantId,
          sourceWeight: headerSourceWeight ?? agent.sourceWeight,
        };
      }
    }

    // No context resolved → leave req.agentContext undefined.
    // Service layer is responsible for sensible defaults when this happens
    // (non-MCP callers like BoardRoom AI will hit this path).
    next();
  } catch (err) {
    logger.error('agent-context: unexpected error', { err: (err as Error).message });
    // Fail open — don't block the request on context-resolution errors.
    next();
  }
}
