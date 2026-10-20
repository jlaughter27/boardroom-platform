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
  MCP_IDENTITY_LIST_DEFAULT_LIMIT,
  MCP_IDENTITY_LIST_MAX_LIMIT,
  MCP_OAUTH_DEFAULT_SCOPES,
  MCP_SCOPE_DESCRIPTORS,
  MCP_SCOPES,
  MCP_TOKEN_DEFAULT_EXPIRES_IN_DAYS,
  MCP_TOKEN_DISPLAY_PREFIX_LENGTH,
  MCP_TOKEN_MAX_ACTIVE_PER_USER,
  MCP_TOKEN_PREFIX,
  MCP_TOKEN_RANDOM_BYTES,
  MCP_TOKEN_REVOKED_LIST_WINDOW_DAYS,
  type McpAuditStats,
  type McpIdentityCreateRequest,
  type McpIdentityListQuery,
  type McpIdentityResolveRequest,
  type McpIdentityResolveResponse,
  type McpIdentityUpdateRequest,
  type McpOauthIdentityRecord,
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
/** Chars of the row id appended to an agentName (token and OAuth). ~48 bits. */
export const AGENT_NAME_SUFFIX_LENGTH = 8;
/** Optional comma-separated issuer allow-list for OAuth auto-link / resolve. */
export const OAUTH_ALLOWED_ISSUERS_ENV = 'MCP_OAUTH_ALLOWED_ISSUERS';
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
 * Row id generated client-side so the agentName — which embeds the last
 * `AGENT_NAME_SUFFIX_LENGTH` chars of the id — can be written in the same
 * INSERT. `c` + 18 CSPRNG bytes as base64url (24 chars, 144 bits, no modulo
 * bias). Matches the `x-mcp-principal` grammar `[A-Za-z0-9_-]{1,64}`; these
 * ids are never validated as user CUIDs.
 */
export function generateRowId(): string {
  return `c${randomBytes(18).toString('base64url')}`;
}

/** Prisma unique-constraint violation (duck-typed so mocked clients can raise it). */
export function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'P2002';
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
  return `mcp-token:${slugify(name)}-${id.slice(-AGENT_NAME_SUFFIX_LENGTH)}`;
}

/** `oauth:<clientId or issuer host or raw issuer>` — the per-client part of an OAuth agentName. */
export function oauthAgentNameBase(issuer: string, clientId?: string): string {
  if (clientId && clientId.trim().length > 0) return `oauth:${clientId.trim()}`;
  try {
    const host = new URL(issuer).host;
    if (host) return `oauth:${host}`;
  } catch {
    // issuer is not a URL — fall through
  }
  return `oauth:${issuer.trim()}`;
}

/**
 * Unique per identity: `oauth:<clientId or issuer host>-<last 8 chars of id>`.
 * Review A5: two users behind one OAuth client used to collapse into one
 * agentName → one rate bucket, indistinguishable audit rows.
 */
export function buildOauthAgentName(issuer: string, clientId: string | undefined, id: string): string {
  return `${oauthAgentNameBase(issuer, clientId)}-${id.slice(-AGENT_NAME_SUFFIX_LENGTH)}`;
}

/** `lower(trim(email))` — the only form compared against `users.email` (which is matched case-insensitively). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Issuers compare trimmed and without a trailing slash (`https://idp/` ≡ `https://idp`). */
export function normalizeIssuer(issuer: string): string {
  return issuer.trim().replace(/\/+$/, '');
}

/**
 * `MCP_OAUTH_ALLOWED_ISSUERS` → set of normalised issuers, or null when the
 * variable is unset/blank (= any issuer the gateway verified is accepted).
 */
export function parseAllowedIssuers(raw: string | undefined): ReadonlySet<string> | null {
  if (raw === undefined) return null;
  const list = raw.split(',').map(normalizeIssuer).filter(v => v.length > 0);
  return list.length > 0 ? new Set(list) : null;
}

export function isIssuerAllowed(issuer: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const allowed = parseAllowedIssuers(env[OAUTH_ALLOWED_ISSUERS_ENV]);
  return allowed === null || allowed.has(normalizeIssuer(issuer));
}

/** Hex chars of sha256(subject) written to logs in place of the subject itself. */
export const SUBJECT_HASH_PREFIX_LENGTH = 12;

/**
 * What an unlinked-attempt log line carries instead of the OAuth subject: the
 * first 12 hex chars of sha256(subject). Enough for an operator to correlate
 * repeated attempts; never reversible to the provider's identifier.
 */
export function subjectHashPrefix(subject: string): string {
  return createHash('sha256').update(subject).digest('hex').slice(0, SUBJECT_HASH_PREFIX_LENGTH);
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

export function toIdentityRecord(row: McpOauthIdentity): McpOauthIdentityRecord {
  return {
    id: row.id,
    issuer: row.issuer,
    subject: row.subject,
    userId: row.userId,
    tenantId: row.tenantId,
    agentName: row.agentName,
    scopes: normalizeScopes(row.scopes),
    sourceWeight: row.sourceWeight,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
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

  // Review A9: omitted → 365 days; `null` is the explicit "never expires".
  const expiresInDays = input.expiresInDays === undefined ? MCP_TOKEN_DEFAULT_EXPIRES_IN_DAYS : input.expiresInDays;
  const expiresAt = expiresInDays === null
    ? null
    : new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000);

  // Review A10: a unique violation (agentName suffix / token hash) is retried
  // once with fresh random material instead of surfacing as a 500.
  let row: McpToken | null = null;
  let raw = '';
  for (let attempt = 0; attempt < 2 && !row; attempt++) {
    raw = generateRawMcpToken();
    const id = generateRowId();
    try {
      row = await prisma.mcpToken.create({
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
    } catch (err) {
      if (!isUniqueViolation(err) || attempt === 1) throw err;
      logger.warn('mcp-token: unique violation on create — retrying once with a fresh id', { userId: input.userId });
    }
  }
  if (!row) throw new Error('mcp-token: create did not return a row');

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

/** Why a resolve ended `unlinked` — written to the warn line so an operator can act on it. */
export type UnlinkedAttemptReason = 'revoked' | 'no_verified_email' | 'user_not_found' | 'no_owned_tenant';

/**
 * Every `unlinked` outcome is logged at warn with enough to find the subject
 * in the identity provider's dashboard and link it with `POST /mcp/identities`
 * — but NEVER the subject or the e-mail themselves: only `subjectHash`
 * (first 12 hex of sha256) and whether an e-mail / a verified flag arrived.
 */
function logUnlinkedAttempt(
  input: McpIdentityResolveRequest,
  issuer: string,
  reason: UnlinkedAttemptReason,
  extra: Record<string, unknown> = {}
): void {
  logger.warn('mcp-token: OAuth identity unlinked — link it with POST /mcp/identities', {
    issuer,
    subjectHash: subjectHashPrefix(input.subject),
    reason,
    emailPresent: typeof input.email === 'string' && input.email.length > 0,
    emailVerified: input.emailVerified === true,
    clientId: input.clientId ?? null,
    ...extra,
  });
}

function activeIdentityResponse(
  row: McpOauthIdentity,
  now: Date,
  input: McpIdentityResolveRequest,
  issuer: string
): McpIdentityResolveResponse {
  // A revoked link is deliberately not re-created by auto-link: the operator
  // revoked it, so the identity stays unlinked until the operator re-links it
  // (POST /mcp/identities on the same (issuer, subject) reactivates the row;
  // PATCH /mcp/identities/:id cannot un-revoke).
  if (row.revokedAt) {
    logUnlinkedAttempt(input, issuer, 'revoked', { identityId: row.id });
    return { active: false, reason: 'unlinked' };
  }
  touchLastUsed('oauth', row.id, now);
  return { active: true, principal: identityToPrincipal(row) };
}

export async function resolveMcpIdentity(
  input: McpIdentityResolveRequest,
  now: Date = new Date()
): Promise<McpIdentityResolveResponse> {
  // Review A6: an API-side issuer allow-list so a misconfigured second
  // gateway cannot resolve/auto-link against an IdP the operator never chose.
  if (!isIssuerAllowed(input.issuer)) {
    logger.warn('mcp-token: OAuth issuer refused by MCP_OAUTH_ALLOWED_ISSUERS', { issuer: input.issuer });
    return { active: false, reason: 'issuer_not_allowed' };
  }

  // Rows are keyed by the NORMALISED issuer (trailing slash trimmed) — the same
  // form `POST /mcp/identities` stores — so an operator-linked `https://idp`
  // matches a JWT whose `iss` is `https://idp/`.
  const issuer = normalizeIssuer(input.issuer);

  const existing = await prisma.mcpOauthIdentity.findUnique({
    where: { issuer_subject: { issuer, subject: input.subject } },
  });
  if (existing) return activeIdentityResponse(existing, now, input, issuer);

  if (input.emailVerified !== true || !input.email) {
    logUnlinkedAttempt(input, issuer, 'no_verified_email');
    return { active: false, reason: 'unlinked' };
  }

  // Review A6: `users.email` is stored as typed; compare lower(trim()) on both sides.
  const user = await prisma.user.findFirst({
    where: { email: { equals: normalizeEmail(input.email), mode: 'insensitive' } },
    select: { id: true },
  });
  if (!user) {
    logUnlinkedAttempt(input, issuer, 'user_not_found');
    return { active: false, reason: 'unlinked' };
  }

  // Review D/M6: a user who owns several tenants (the primary operator owns
  // all three) is linked to the OLDEST-created owned tenant, deterministically;
  // the operator re-points it with PATCH /mcp/identities/:id.
  const tenants = await prisma.tenant.findMany({
    where: { ownerUserId: user.id },
    select: { id: true, createdAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (tenants.length === 0) {
    logUnlinkedAttempt(input, issuer, 'no_owned_tenant', { userId: user.id });
    return { active: false, reason: 'unlinked' };
  }
  const tenantId = tenants[0].id;

  // Review A6: two concurrent first-resolves race on (issuer, subject) —
  // re-read the winner instead of surfacing P2002 as a 500. A P2002 on the
  // agentName suffix (A10) is retried once with a fresh id.
  for (let attempt = 0; attempt < 2; attempt++) {
    const id = generateRowId();
    try {
      const created = await prisma.mcpOauthIdentity.create({
        data: {
          id,
          issuer,
          subject: input.subject,
          userId: user.id,
          tenantId,
          agentName: buildOauthAgentName(issuer, input.clientId, id),
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
        tenantCount: tenants.length,
        issuer,
      });
      return { active: true, principal: identityToPrincipal(created) };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const winner = await prisma.mcpOauthIdentity.findUnique({
        where: { issuer_subject: { issuer, subject: input.subject } },
      });
      if (winner) return activeIdentityResponse(winner, now, input, issuer);
      if (attempt === 1) throw err;
      logger.warn('mcp-token: unique violation on identity create — retrying once with a fresh id', { issuer });
    }
  }
  /* istanbul ignore next -- loop always returns or throws */
  throw new Error('mcp-token: identity create did not return a row');
}

// ── OAuth identity administration (x-admin-key routes) ──────────────────────

/**
 * `userId` omitted → every identity (newest first) so an operator can see the
 * whole table; `limit` is clamped to 1..MCP_IDENTITY_LIST_MAX_LIMIT. Revoked
 * rows are always included.
 */
export async function listMcpIdentities(query: McpIdentityListQuery = {}): Promise<McpOauthIdentityRecord[]> {
  const requested = query.limit ?? MCP_IDENTITY_LIST_DEFAULT_LIMIT;
  const take = Math.min(MCP_IDENTITY_LIST_MAX_LIMIT, Math.max(1, Math.trunc(requested)));
  const rows = await prisma.mcpOauthIdentity.findMany({
    where: query.userId ? { userId: query.userId } : {},
    orderBy: { createdAt: 'desc' },
    take,
  });
  return rows.map(toIdentityRecord);
}

export type McpIdentityCreateOutcome = 'created' | 'reactivated';

export interface McpIdentityCreateResult {
  outcome: McpIdentityCreateOutcome;
  identity: McpOauthIdentityRecord;
}

/**
 * Operator-driven link of an `(issuer, subject)` pair to a user — for identity
 * providers whose access tokens carry no verified e-mail, where auto-link on
 * resolve can never fire.
 *
 * Order of checks (each is final):
 *   1. issuer normalised, refused when `MCP_OAUTH_ALLOWED_ISSUERS` is set and
 *      excludes it → 403 `issuer_not_allowed`
 *   2. an ACTIVE row for the pair → 409 `identity_exists { existingId }`
 *      (re-point / re-scope it with PATCH instead)
 *   3. unknown `userId` → 404 `user_not_found`
 *   4. `tenantId` not owned by that user → 403 `tenant_not_owned`
 *   5. a REVOKED row for the pair → reactivated IN PLACE: `(issuer, subject)`
 *      is unique regardless of `revokedAt`, so a second row is impossible.
 *      `revokedAt` is cleared, userId / tenantId / scopes / sourceWeight are
 *      replaced, the id (hence the agentName suffix) and createdAt are kept,
 *      the agentName is rebuilt only when a `clientId` is supplied, and the
 *      delegation cache is evicted → `reactivated` (route answers 200)
 *   6. otherwise a new row → `created` (route answers 201). A P2002 on the
 *      pair (concurrent resolve/auto-link) is re-read and reported as 409;
 *      an agentName collision is retried once with a fresh id (A10).
 */
export async function createMcpIdentity(
  input: McpIdentityCreateRequest,
  now: Date = new Date()
): Promise<McpIdentityCreateResult> {
  if (!isIssuerAllowed(input.issuer)) {
    throw new HttpError(403, {
      code: 'issuer_not_allowed',
      message: `Issuer '${input.issuer}' is not in ${OAUTH_ALLOWED_ISSUERS_ENV}`,
    });
  }
  const issuer = normalizeIssuer(input.issuer);
  const subject = input.subject;
  const scopes: McpScope[] = input.scopes && input.scopes.length > 0 ? [...input.scopes] : [...MCP_OAUTH_DEFAULT_SCOPES];
  const sourceWeight = input.sourceWeight ?? 1.0;

  const existingActiveConflict = (row: McpOauthIdentity): HttpError => new HttpError(409, {
    code: 'identity_exists',
    message: `An active identity already exists for this (issuer, subject); re-point or re-scope it with PATCH /mcp/identities/${row.id}`,
    existingId: row.id,
  });

  const existing = await prisma.mcpOauthIdentity.findUnique({ where: { issuer_subject: { issuer, subject } } });
  if (existing && !existing.revokedAt) throw existingActiveConflict(existing);

  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true } });
  if (!user) {
    throw new HttpError(404, { code: 'user_not_found', message: `User '${input.userId}' not found` });
  }
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

  if (existing) {
    const data: {
      revokedAt: null; userId: string; tenantId: string; scopes: string[]; sourceWeight: number; agentName?: string;
    } = { revokedAt: null, userId: user.id, tenantId: tenant.id, scopes, sourceWeight };
    if (input.clientId) data.agentName = buildOauthAgentName(issuer, input.clientId, existing.id);
    const updated = await prisma.mcpOauthIdentity.update({ where: { id: existing.id }, data });
    evictDelegatedPrincipal(`oauth:${existing.id}`);
    logger.info('mcp-token: OAuth identity reactivated by operator', {
      id: updated.id,
      userId: updated.userId,
      tenantId: updated.tenantId,
      scopes: updated.scopes,
      agentName: updated.agentName,
      issuer,
    });
    return { outcome: 'reactivated', identity: toIdentityRecord(updated) };
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const id = generateRowId();
    try {
      const created = await prisma.mcpOauthIdentity.create({
        data: {
          id,
          issuer,
          subject,
          userId: user.id,
          tenantId: tenant.id,
          agentName: buildOauthAgentName(issuer, input.clientId, id),
          scopes,
          sourceWeight,
          createdAt: now,
        },
      });
      logger.info('mcp-token: OAuth identity linked by operator', {
        id: created.id,
        userId: created.userId,
        tenantId: created.tenantId,
        scopes: created.scopes,
        agentName: created.agentName,
        issuer,
      });
      return { outcome: 'created', identity: toIdentityRecord(created) };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Lost a race with resolve/auto-link (or another operator) on the pair →
      // report the winner as the 409; otherwise the suffix collided → retry.
      const winner = await prisma.mcpOauthIdentity.findUnique({ where: { issuer_subject: { issuer, subject } } });
      if (winner) throw existingActiveConflict(winner);
      if (attempt === 1) throw err;
      logger.warn('mcp-token: unique violation on operator identity create — retrying once with a fresh id', { issuer });
    }
  }
  /* istanbul ignore next -- loop always returns or throws */
  throw new Error('mcp-token: identity create did not return a row');
}

/**
 * Re-point / re-scope an identity. `tenantId` must be owned by the identity's
 * user (→ 403 `tenant_not_owned`); `scopes` are already a validated subset of
 * MCP_SCOPES. Returns null when no identity has that id (→ 404). Evicts the
 * delegation cache so the change applies on the next request, not in ≤60 s.
 */
export async function updateMcpIdentity(id: string, patch: McpIdentityUpdateRequest): Promise<McpOauthIdentityRecord | null> {
  const row = await prisma.mcpOauthIdentity.findUnique({ where: { id } });
  if (!row) return null;
  const data: { tenantId?: string; scopes?: string[] } = {};
  if (patch.tenantId !== undefined && patch.tenantId !== row.tenantId) {
    const tenant = await prisma.tenant.findFirst({
      where: { id: patch.tenantId, ownerUserId: row.userId },
      select: { id: true },
    });
    if (!tenant) {
      throw new HttpError(403, {
        code: 'tenant_not_owned',
        message: `Tenant '${patch.tenantId}' is not owned by user '${row.userId}'`,
      });
    }
    data.tenantId = tenant.id;
  }
  if (patch.scopes !== undefined) data.scopes = [...patch.scopes];
  const updated = Object.keys(data).length > 0
    ? await prisma.mcpOauthIdentity.update({ where: { id: row.id }, data })
    : row;
  evictDelegatedPrincipal(`oauth:${row.id}`);
  logger.info('mcp-token: OAuth identity updated', { id: row.id, userId: row.userId, ...data });
  return toIdentityRecord(updated);
}

/** Revoke (never delete). false when no identity has that id (→ 404); idempotent. */
export async function revokeMcpIdentity(id: string, now: Date = new Date()): Promise<boolean> {
  const row = await prisma.mcpOauthIdentity.findUnique({ where: { id } });
  if (!row) return false;
  if (!row.revokedAt) {
    await prisma.mcpOauthIdentity.update({ where: { id: row.id }, data: { revokedAt: now } });
    logger.info('mcp-token: OAuth identity revoked', { id: row.id, userId: row.userId, agentName: row.agentName });
  }
  evictDelegatedPrincipal(`oauth:${row.id}`);
  return true;
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
