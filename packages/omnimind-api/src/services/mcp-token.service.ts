/**
 * mcp-token.service — Lane A1 (2026-10-18)
 *
 * Per-user MCP tokens (`omt_…`) and OAuth identity resolution so one MCP
 * gateway URL can serve many users. The gateway is a registered Agent whose
 * row holds the `mcp:delegate` scope; it calls `introspect` / `resolve` to
 * learn the principal and then sends `x-mcp-principal: token:<id>|oauth:<id>`
 * on every OmniMind request (see middleware/agent-context.ts).
 *
 * Storage rules:
 *   - the raw token is returned once at creation and NEVER stored; only
 *     sha256(raw) (`tokenHash`, unique) and a 12-char display `prefix`
 *   - revocation is a timestamp (`revokedAt`), never a delete
 *   - `lastUsedAt` is touched at most once per 5 minutes per row
 *
 * Delegation lookups are cached in memory for 60 s keyed by the header value;
 * `revokeMcpToken` evicts synchronously. Expiry is always evaluated against
 * the request clock, never the cache clock, so a token that expires inside
 * the cache window is still refused on time.
 */

import { createHash, randomBytes } from 'crypto';
import type { McpOauthIdentity, McpToken } from '@prisma/client';
import {
  MCP_OAUTH_DEFAULT_SCOPES,
  MCP_SCOPE_DESCRIPTORS,
  MCP_SCOPES,
  MCP_TOKEN_DISPLAY_PREFIX_LENGTH,
  MCP_TOKEN_MAX_ACTIVE_PER_USER,
  MCP_TOKEN_PREFIX,
  MCP_TOKEN_RANDOM_BYTES,
  MCP_TOKEN_REVOKED_LIST_WINDOW_DAYS,
  type McpAuditStats,
  type McpIdentityResolveRequest,
  type McpIdentityResolveResponse,
  type McpPrincipal,
  type McpPrincipalKind,
  type McpScope,
  type McpTokenCreateRequest,
  type McpTokenCreateResponse,
  type McpTokenIntrospectResponse,
  type McpTokenOptions,
  type McpTokenRecord,
} from '@boardroom/shared';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { HttpError } from '../middleware/error-handler';

// ── Constants ───────────────────────────────────────────────────────────────

export const PRINCIPAL_CACHE_TTL_MS = 60 * 1000;
const LAST_USED_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
/** Upper bound on audit rows pulled into memory for percentile math. */
export const AUDIT_STATS_MAX_ROWS = 10_000;

// ── Pure helpers (exported for tests) ───────────────────────────────────────

export function hashMcpToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** `omt_` + 32 random bytes base64url (43 chars → 47 total). */
export function generateRawMcpToken(): string {
  return `${MCP_TOKEN_PREFIX}${randomBytes(MCP_TOKEN_RANDOM_BYTES).toString('base64url')}`;
}

/**
 * cuid-shaped id (`c` + 24 base36 chars) generated client-side so the
 * agentName — which embeds 6 chars of the id — can be written in the same
 * INSERT. Shape matches user-validator's CUID_REGEX.
 */
export function generateRowId(): string {
  const bytes = randomBytes(24);
  let out = 'c';
  for (let i = 0; i < 24; i++) out += (bytes[i] % 36).toString(36);
  return out;
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'token';
}

export function buildTokenAgentName(name: string, id: string): string {
  return `mcp-token:${slugify(name)}-${id.slice(-6)}`;
}

export function buildOauthAgentName(issuer: string, clientId?: string): string {
  if (clientId && clientId.trim().length > 0) return `oauth:${clientId.trim()}`;
  try {
    const host = new URL(issuer).host;
    if (host) return `oauth:${host}`;
  } catch {
    // issuer is not a URL — fall through
  }
  return `oauth:${issuer.trim()}`;
}

const KNOWN_SCOPES: ReadonlySet<string> = new Set<string>(MCP_SCOPES);

export function isMcpScope(value: string): value is McpScope {
  return KNOWN_SCOPES.has(value);
}

/** Drops anything that is not a grantable scope (defensive: rows are operator-editable). */
export function normalizeScopes(scopes: readonly string[]): McpScope[] {
  return scopes.filter(isMcpScope);
}

export type TokenStatus = 'active' | 'revoked' | 'expired';

export function tokenStatus(row: Pick<McpToken, 'revokedAt' | 'expiresAt'>, now: Date): TokenStatus {
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'active';
}

export function toTokenRecord(row: McpToken): McpTokenRecord {
  return {
    id: row.id,
    userId: row.userId,
    tenantId: row.tenantId,
    name: row.name,
    agentName: row.agentName,
    prefix: row.prefix,
    scopes: normalizeScopes(row.scopes),
    sourceWeight: row.sourceWeight,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
  };
}

export function tokenToPrincipal(row: McpToken): McpPrincipal {
  return {
    kind: 'token',
    id: row.id,
    userId: row.userId,
    tenantId: row.tenantId,
    agentName: row.agentName,
    scopes: normalizeScopes(row.scopes),
    sourceWeight: row.sourceWeight,
    name: row.name,
    ...(row.expiresAt ? { expiresAt: row.expiresAt.toISOString() } : {}),
  };
}

export function identityToPrincipal(row: McpOauthIdentity): McpPrincipal {
  return {
    kind: 'oauth',
    id: row.id,
    userId: row.userId,
    tenantId: row.tenantId,
    agentName: row.agentName,
    scopes: normalizeScopes(row.scopes),
    sourceWeight: row.sourceWeight,
  };
}

/** Nearest-rank percentile over an unsorted sample. Empty → 0. */
export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(q * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx];
}

// ── lastUsedAt throttle ─────────────────────────────────────────────────────

const lastUsedTouchedAt = new Map<string, number>();

function touchLastUsed(kind: McpPrincipalKind, id: string, now: Date): void {
  const key = `${kind}:${id}`;
  const last = lastUsedTouchedAt.get(key) ?? 0;
  if (now.getTime() - last < LAST_USED_TOUCH_INTERVAL_MS) return;
  lastUsedTouchedAt.set(key, now.getTime());
  // Fire-and-forget; a failed touch must never fail the request (sync or async).
  void (async () => {
    try {
      if (kind === 'token') await prisma.mcpToken.update({ where: { id }, data: { lastUsedAt: now } });
      else await prisma.mcpOauthIdentity.update({ where: { id }, data: { lastUsedAt: now } });
    } catch (err) {
      logger.warn('mcp-token: lastUsedAt update failed', { kind, id, err: (err as Error).message });
    }
  })();
}

// ── Token CRUD ──────────────────────────────────────────────────────────────

export async function createMcpToken(input: McpTokenCreateRequest, now: Date = new Date()): Promise<McpTokenCreateResponse> {
  const tenant = await prisma.tenant.findFirst({
    where: { id: input.tenantId, ownerUserId: input.userId },
    select: { id: true },
  });
  if (!tenant) {
    throw new HttpError(403, {
      code: 'tenant_not_owned',
      message: `Tenant '${input.tenantId}' is not owned by user '${input.userId}'`,
    });
  }

  const active = await prisma.mcpToken.count({
    where: {
      userId: input.userId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  });
  if (active >= MCP_TOKEN_MAX_ACTIVE_PER_USER) {
    throw new HttpError(409, {
      code: 'token_limit',
      message: `User already has ${MCP_TOKEN_MAX_ACTIVE_PER_USER} active MCP tokens; revoke one first`,
    });
  }

  const raw = generateRawMcpToken();
  const id = generateRowId();
  const expiresAt = input.expiresInDays
    ? new Date(now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const row = await prisma.mcpToken.create({
    data: {
      id,
      userId: input.userId,
      tenantId: input.tenantId,
      name: input.name,
      agentName: buildTokenAgentName(input.name, id),
      prefix: raw.slice(0, MCP_TOKEN_DISPLAY_PREFIX_LENGTH),
      tokenHash: hashMcpToken(raw),
      scopes: [...input.scopes],
      sourceWeight: input.sourceWeight ?? 1.0,
      createdAt: now,
      expiresAt,
    },
  });

  logger.info('mcp-token: created', { id: row.id, userId: row.userId, tenantId: row.tenantId, agentName: row.agentName });
  return { token: raw, record: toTokenRecord(row) };
}

export async function listMcpTokens(userId: string, now: Date = new Date()): Promise<McpTokenRecord[]> {
  const cutoff = new Date(now.getTime() - MCP_TOKEN_REVOKED_LIST_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await prisma.mcpToken.findMany({
    where: {
      userId,
      OR: [{ revokedAt: null }, { revokedAt: { gte: cutoff } }],
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toTokenRecord);
}

/** Returns false when no token with that id belongs to the user (→ 404). Idempotent on already-revoked rows. */
export async function revokeMcpToken(id: string, userId: string, now: Date = new Date()): Promise<boolean> {
  const row = await prisma.mcpToken.findFirst({ where: { id, userId } });
  if (!row) return false;
  if (!row.revokedAt) {
    await prisma.mcpToken.update({ where: { id: row.id }, data: { revokedAt: now } });
    logger.info('mcp-token: revoked', { id: row.id, userId, agentName: row.agentName });
  }
  evictDelegatedPrincipal(`token:${row.id}`);
  return true;
}

export async function getMcpTokenOptions(userId: string): Promise<McpTokenOptions> {
  const tenants = await prisma.tenant.findMany({
    where: { ownerUserId: userId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return { tenants, scopes: MCP_SCOPE_DESCRIPTORS.map(d => ({ ...d })) };
}

// ── Introspection / resolution (gateway-facing) ─────────────────────────────

export async function introspectMcpToken(raw: string, now: Date = new Date()): Promise<McpTokenIntrospectResponse> {
  const row = await prisma.mcpToken.findUnique({ where: { tokenHash: hashMcpToken(raw) } });
  if (!row) return { active: false, reason: 'invalid' };
  const status = tokenStatus(row, now);
  if (status !== 'active') return { active: false, reason: status };
  touchLastUsed('token', row.id, now);
  return { active: true, principal: tokenToPrincipal(row) };
}

export async function resolveMcpIdentity(
  input: McpIdentityResolveRequest,
  now: Date = new Date()
): Promise<McpIdentityResolveResponse> {
  const existing = await prisma.mcpOauthIdentity.findUnique({
    where: { issuer_subject: { issuer: input.issuer, subject: input.subject } },
  });
  if (existing) {
    // A revoked link is deliberately not re-created by auto-link: the
    // operator revoked it, so the identity stays unlinked until re-linked.
    if (existing.revokedAt) return { active: false, reason: 'unlinked' };
    touchLastUsed('oauth', existing.id, now);
    return { active: true, principal: identityToPrincipal(existing) };
  }

  if (input.emailVerified !== true || !input.email) return { active: false, reason: 'unlinked' };

  const user = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (!user) return { active: false, reason: 'unlinked' };

  const tenants = await prisma.tenant.findMany({ where: { ownerUserId: user.id }, select: { id: true } });
  if (tenants.length !== 1) {
    logger.info('mcp-token: auto-link skipped — user does not own exactly one tenant', {
      userId: user.id,
      tenantCount: tenants.length,
      issuer: input.issuer,
    });
    return { active: false, reason: 'unlinked' };
  }

  const created = await prisma.mcpOauthIdentity.create({
    data: {
      issuer: input.issuer,
      subject: input.subject,
      userId: user.id,
      tenantId: tenants[0].id,
      agentName: buildOauthAgentName(input.issuer, input.clientId),
      scopes: [...MCP_OAUTH_DEFAULT_SCOPES],
      sourceWeight: 1.0,
      createdAt: now,
      lastUsedAt: now,
    },
  });
  logger.info('mcp-token: OAuth identity auto-linked (read-only)', {
    id: created.id,
    userId: created.userId,
    tenantId: created.tenantId,
    issuer: input.issuer,
  });
  return { active: true, principal: identityToPrincipal(created) };
}

// ── Audit stats ─────────────────────────────────────────────────────────────

export interface AuditStatsQuery {
  tool?: string;
  sinceHours: number;
  tenantId?: string;
}

export async function getMcpAuditStats(q: AuditStatsQuery, now: Date = new Date()): Promise<McpAuditStats> {
  const since = new Date(now.getTime() - q.sinceHours * 60 * 60 * 1000);
  const rows = await prisma.mcpAuditLog.findMany({
    where: {
      createdAt: { gte: since },
      ...(q.tool ? { toolName: q.tool } : {}),
      ...(q.tenantId ? { tenantId: q.tenantId } : {}),
    },
    select: { durationMs: true, errorMessage: true },
    orderBy: { createdAt: 'desc' },
    take: AUDIT_STATS_MAX_ROWS,
  });
  const durations = rows.map(r => r.durationMs);
  const errors = rows.filter(r => typeof r.errorMessage === 'string' && r.errorMessage.length > 0).length;
  return {
    tool: q.tool ?? null,
    sinceHours: q.sinceHours,
    count: rows.length,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    errorRate: rows.length === 0 ? 0 : errors / rows.length,
  };
}

// ── Delegation cache (used by agent-context) ────────────────────────────────

interface CachedPrincipal {
  kind: McpPrincipalKind;
  row: McpToken | McpOauthIdentity;
  fetchedAt: number;
}

const principalCache = new Map<string, CachedPrincipal>();

export type DelegatedPrincipalFailure = 'malformed' | 'not_found' | 'revoked' | 'expired';

export type DelegatedPrincipalResult =
  | { ok: true; principal: McpPrincipal }
  | { ok: false; reason: DelegatedPrincipalFailure };

const PRINCIPAL_REF_RE = /^(token|oauth):([A-Za-z0-9_-]{1,64})$/;

export function parsePrincipalRef(ref: string): { kind: McpPrincipalKind; id: string } | null {
  const m = PRINCIPAL_REF_RE.exec(ref.trim());
  if (!m) return null;
  return { kind: m[1] as McpPrincipalKind, id: m[2] };
}

export function evictDelegatedPrincipal(ref: string): void {
  principalCache.delete(ref.trim());
}

export async function loadDelegatedPrincipal(ref: string, now: Date = new Date()): Promise<DelegatedPrincipalResult> {
  const parsed = parsePrincipalRef(ref);
  if (!parsed) return { ok: false, reason: 'malformed' };
  const key = ref.trim();

  let cached = principalCache.get(key);
  if (cached && now.getTime() - cached.fetchedAt >= PRINCIPAL_CACHE_TTL_MS) {
    principalCache.delete(key);
    cached = undefined;
  }

  if (!cached) {
    const row = parsed.kind === 'token'
      ? await prisma.mcpToken.findUnique({ where: { id: parsed.id } })
      : await prisma.mcpOauthIdentity.findUnique({ where: { id: parsed.id } });
    if (!row) return { ok: false, reason: 'not_found' };
    cached = { kind: parsed.kind, row, fetchedAt: now.getTime() };
    principalCache.set(key, cached);
  }

  if (cached.kind === 'token') {
    const row = cached.row as McpToken;
    const status = tokenStatus(row, now);
    if (status !== 'active') {
      principalCache.delete(key);
      return { ok: false, reason: status };
    }
    touchLastUsed('token', row.id, now);
    return { ok: true, principal: tokenToPrincipal(row) };
  }

  const row = cached.row as McpOauthIdentity;
  if (row.revokedAt) {
    principalCache.delete(key);
    return { ok: false, reason: 'revoked' };
  }
  touchLastUsed('oauth', row.id, now);
  return { ok: true, principal: identityToPrincipal(row) };
}

export function __resetMcpTokenStateForTest(): void {
  principalCache.clear();
  lastUsedTouchedAt.clear();
}
