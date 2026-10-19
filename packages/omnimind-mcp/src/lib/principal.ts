/**
 * Front door — bearer credential → principal resolution for the HTTP transport.
 *
 * One public URL, three credential types, one resolution order:
 *   (a) the legacy static key (`OMNIMIND_MCP_API_KEY`)        → `static` principal from env
 *   (b) `omt_…` personal tokens (`OMNIMIND_MCP_TOKEN_AUTH`)   → `POST /mcp/tokens/introspect`
 *   (c) OAuth access tokens (`OMNIMIND_MCP_OAUTH_ISSUER`)      → JWT verified with `jose`
 *                                                                 (RFC 8707 audience) then
 *                                                                 `POST /mcp/identities/resolve`
 *
 * OIDC userinfo fallback (c): real identity providers (WorkOS AuthKit, Auth0,
 * …) commonly mint access tokens WITHOUT `email` / `email_verified`, so the
 * API's auto-link by verified e-mail would never fire and every OAuth user
 * would stay `unlinked`. When a verified JWT lacks a verified e-mail and the
 * issuer's discovery document exposes a `userinfo_endpoint` (https only, same
 * rule as `jwks_uri`), the endpoint is fetched once per (issuer, sub) with the
 * same access token and its `email` / `email_verified` are forwarded instead —
 * provided its `sub` equals the JWT `sub`. Any failure degrades to the no-email
 * path (→ `unlinked` → 401). `OMNIMIND_MCP_OAUTH_USERINFO=false` disables it.
 *
 * Results are cached under the sha256 of the credential — positives for
 * `OMNIMIND_MCP_PRINCIPAL_CACHE_MS` (30 s by default, 5 s..300 s), negatives
 * for 10 s; the raw credential is never logged or used as a key. A positive
 * is also evicted the moment any delegated call for that principal is refused
 * with `401 principal_invalid` (`evictPrincipal`), so revocation in BoardRoom
 * is effective immediately for data access and the TTL only bounds how long
 * an *idle* client keeps an open session.
 * Introspection and identity resolution are made by the GATEWAY client
 * (static identity + `x-agent-key` with scope `mcp:delegate`), never by a
 * per-session delegated client.
 */
import { createHash, timingSafeEqual } from 'crypto';
import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { fetch as undiciFetch } from 'undici';
import { z } from 'zod';
import { MCP_SCOPES as SHARED_MCP_SCOPES, MCP_GATEWAY_CEILING_SCOPES, MCP_DELEGATE_SCOPE, MCP_TOKEN_PREFIX, MCP_TOKEN_RANDOM_BYTES } from '@boardroom/shared';
import { assertSourceWeight } from './auth';
import { OmniMindHttpError } from './client';
import { LruTtlCache } from './replay-cache';
import type { IdentityClaims, IntrospectResult, OmniMindClient, ResolveIdentityResult } from './client';
import { principalKeyOf } from '../types';
import type { AgentContext, McpPrincipal } from '../types';

/**
 * Every scope an OmniMind token / identity can hold (advertised in the PRM
 * document). The shared constant is the single vocabulary the API, BoardRoom
 * and this server agree on; re-exported here for existing importers.
 */
export const MCP_SCOPES = SHARED_MCP_SCOPES;
/**
 * L-6 — the most a delegated context can ever hold: the gateway ceiling minus
 * the gateway-only `mcp:delegate`. The API computes `principal ∩ (gateway row −
 * mcp:delegate)`; applying the same ceiling here means `requireScope()` and the
 * API agree, and a wildcard principal is expanded to the explicit list rather
 * than passing locally and failing upstream.
 */
export const DELEGATED_SCOPE_CEILING: readonly string[] = MCP_GATEWAY_CEILING_SCOPES.filter(s => s !== MCP_DELEGATE_SCOPE);
/** JWS algorithm allowlist for OAuth access tokens — asymmetric only, never HS*. */
export const OAUTH_ALGORITHMS = ['RS256', 'ES256', 'EdDSA'] as const;
/** Default positive-cache TTL; `OMNIMIND_MCP_PRINCIPAL_CACHE_MS` overrides within [MIN, MAX]. */
export const PRINCIPAL_CACHE_POSITIVE_MS = 30_000;
export const PRINCIPAL_CACHE_POSITIVE_MIN_MS = 5_000;
export const PRINCIPAL_CACHE_POSITIVE_MAX_MS = 300_000;
export const PRINCIPAL_CACHE_ENV = 'OMNIMIND_MCP_PRINCIPAL_CACHE_MS';
export const PRINCIPAL_CACHE_NEGATIVE_MS = 10_000;
export const PRINCIPAL_CACHE_MAX_ENTRIES = 2_000;
/** Session-binding key of the legacy static credential (one identity per process). */
export const STATIC_PRINCIPAL_KEY = 'static:env';
export const TOKEN_PREFIX: string = MCP_TOKEN_PREFIX;
/** base64url of `MCP_TOKEN_RANDOM_BYTES` random bytes, unpadded: 32 bytes → 43 chars. */
export const TOKEN_RANDOM_CHARS = Math.ceil((MCP_TOKEN_RANDOM_BYTES * 4) / 3);
/** A compact JWS larger than this is refused before any verification (M-4). */
export const JWT_MAX_BYTES = 8 * 1024;
/** RFC 9728 well-known path; also served with the `/mcp` suffix (with or without a trailing slash) for path-scoped resources. */
export const PRM_PATH = '/.well-known/oauth-protected-resource';
/** `OMNIMIND_MCP_OAUTH_USERINFO=false` turns the OIDC userinfo fallback off (default on). */
export const OAUTH_USERINFO_ENV = 'OMNIMIND_MCP_OAUTH_USERINFO';
/** Per-request budget for the userinfo GET. */
export const USERINFO_TIMEOUT_MS = 5_000;
export const DEFAULT_DOCS_URL = 'https://github.com/jlaughter27/boardroom-platform/blob/main/docs/MEMORY-PROTOCOL.md';
/** Clock skew tolerated on `exp` / `nbf` (seconds). */
export const JWT_CLOCK_TOLERANCE_S = 30;

export interface OAuthConfig {
  /** `iss` the token must carry; also the authorization server advertised in the PRM document. */
  issuer: string;
  /** Explicit JWKS URL; when absent it is discovered from the issuer's well-known metadata. */
  jwksUrl?: string;
  /** Expected `aud` (RFC 8707) — `OMNIMIND_MCP_OAUTH_AUDIENCE`, else `OMNIMIND_MCP_PUBLIC_URL`. */
  audience: string;
  /** `false` disables the OIDC userinfo fallback for tokens without a verified e-mail claim; absent / `true` → enabled. */
  userinfo?: boolean;
}

export interface PrincipalAuthConfig {
  /** Legacy single bearer (`OMNIMIND_MCP_API_KEY`). */
  staticApiKey?: string;
  /** `OMNIMIND_MCP_TOKEN_AUTH=true` — accept `omt_…` tokens via introspection. */
  tokenAuth: boolean;
  oauth?: OAuthConfig;
  /** `OMNIMIND_MCP_PUBLIC_URL` — this server's resource identifier (PRM `resource`, default audience). */
  publicUrl?: string;
  /** `OMNIMIND_MCP_AGENT_KEY` — the gateway's own `omk_` key (scope `mcp:delegate`); required for (b) and (c). */
  agentKey?: string;
  /** `OMNIMIND_MCP_DOCS_URL` override for PRM `resource_documentation`. */
  docsUrl?: string;
}

function trimmed(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

/**
 * `OMNIMIND_MCP_PRINCIPAL_CACHE_MS` → positive-cache TTL. Unset / blank /
 * non-numeric → the 30 s default; a number is clamped to [5 s, 300 s] (a
 * shorter TTL would make every request an introspection round-trip, a longer
 * one would let an idle revoked session linger). It bounds only how long a
 * client that makes NO data call keeps an open session after revocation:
 * data calls fail and close the session at once (see `evictPrincipal`).
 */
export function resolvePrincipalCacheMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = trimmed(env[PRINCIPAL_CACHE_ENV]);
  if (!raw || !/^\d+$/.test(raw)) return PRINCIPAL_CACHE_POSITIVE_MS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return PRINCIPAL_CACHE_POSITIVE_MS;
  return Math.min(PRINCIPAL_CACHE_POSITIVE_MAX_MS, Math.max(PRINCIPAL_CACHE_POSITIVE_MIN_MS, n));
}

function isTrue(v: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(v?.trim() ?? '');
}

function isFalse(v: string | undefined): boolean {
  return /^(0|false|no|off)$/i.test(v?.trim() ?? '');
}

function assertHttpUrl(value: string, label: string): string {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute http(s) URL (got ${JSON.stringify(value)})`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`${label} must be an http(s) URL`);
  return value;
}

/** `localhost` / `127.0.0.1` / `::1` — the only hosts allowed to speak plain http for issuer / JWKS URLs. */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

/**
 * L-3 — an authorization-server URL (issuer, JWKS) must be https; plain http
 * is accepted only on loopback (local development). Discovery and key
 * fetching over cleartext would let a MITM substitute signing keys.
 */
export function assertSecureUrl(value: string, label: string): string {
  assertHttpUrl(value, label);
  const u = new URL(value);
  if (u.protocol !== 'https:' && !isLoopbackHost(u.hostname)) {
    throw new Error(`${label} must use https (plain http is only accepted for localhost / 127.0.0.1): got ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Resolve the inbound-auth configuration from env. Throws (with a message the
 * operator can act on) when nothing is configured or a mode is half-configured:
 * HTTP mode must never start open, and token / OAuth modes cannot delegate
 * without the gateway's own agent key.
 */
export function resolvePrincipalAuthConfig(env: NodeJS.ProcessEnv = process.env): PrincipalAuthConfig {
  const staticApiKey = trimmed(env.OMNIMIND_MCP_API_KEY);
  const tokenAuth = isTrue(env.OMNIMIND_MCP_TOKEN_AUTH);
  const issuer = trimmed(env.OMNIMIND_MCP_OAUTH_ISSUER);
  const publicUrl = trimmed(env.OMNIMIND_MCP_PUBLIC_URL);
  const agentKey = trimmed(env.OMNIMIND_MCP_AGENT_KEY);
  const docsUrl = trimmed(env.OMNIMIND_MCP_DOCS_URL);

  if (!staticApiKey && !tokenAuth && !issuer) {
    throw new Error(
      'No inbound authentication configured for HTTP mode: OMNIMIND_MCP_API_KEY is required unless ' +
        'OMNIMIND_MCP_TOKEN_AUTH=true (omt_ tokens) or OMNIMIND_MCP_OAUTH_ISSUER (OAuth) is set. ' +
        'Refusing to start an unauthenticated MCP endpoint.'
    );
  }
  if (tokenAuth && !agentKey) {
    throw new Error('OMNIMIND_MCP_TOKEN_AUTH=true requires OMNIMIND_MCP_AGENT_KEY (the gateway agent key with scope mcp:delegate).');
  }
  if (publicUrl) assertHttpUrl(publicUrl, 'OMNIMIND_MCP_PUBLIC_URL');

  let oauth: OAuthConfig | undefined;
  if (issuer) {
    assertSecureUrl(issuer, 'OMNIMIND_MCP_OAUTH_ISSUER');
    if (!agentKey) throw new Error('OMNIMIND_MCP_OAUTH_ISSUER requires OMNIMIND_MCP_AGENT_KEY (identity resolution is a delegated call).');
    const audience = trimmed(env.OMNIMIND_MCP_OAUTH_AUDIENCE) ?? publicUrl;
    if (!audience || !publicUrl) {
      throw new Error('OMNIMIND_MCP_OAUTH_ISSUER requires OMNIMIND_MCP_PUBLIC_URL (the resource identifier clients bind tokens to; OMNIMIND_MCP_OAUTH_AUDIENCE may override the expected aud).');
    }
    const jwksUrl = trimmed(env.OMNIMIND_MCP_OAUTH_JWKS_URL);
    if (jwksUrl) assertSecureUrl(jwksUrl, 'OMNIMIND_MCP_OAUTH_JWKS_URL');
    // Only an explicit "off" is recorded, so the default config shape is unchanged.
    const userinfoOff = isFalse(env[OAUTH_USERINFO_ENV]);
    oauth = { issuer, audience, ...(jwksUrl ? { jwksUrl } : {}), ...(userinfoOff ? { userinfo: false } : {}) };
  }

  return {
    ...(staticApiKey ? { staticApiKey } : {}),
    tokenAuth,
    ...(oauth ? { oauth } : {}),
    ...(publicUrl ? { publicUrl } : {}),
    ...(agentKey ? { agentKey } : {}),
    ...(docsUrl ? { docsUrl } : {}),
  };
}

/** Human-readable list of the enabled credential types (startup log; never includes secrets). */
export function describeAuthModes(cfg: PrincipalAuthConfig): string[] {
  const modes: string[] = [];
  if (cfg.staticApiKey) modes.push('static key (OMNIMIND_MCP_API_KEY)');
  if (cfg.tokenAuth) modes.push('omt_ tokens (introspection)');
  if (cfg.oauth) modes.push(`OAuth (issuer ${cfg.oauth.issuer}, audience ${cfg.oauth.audience}, userinfo fallback ${cfg.oauth.userinfo === false ? `off (${OAUTH_USERINFO_ENV})` : 'on'})`);
  return modes;
}

export function hasAnyAuthMode(cfg: PrincipalAuthConfig): boolean {
  return Boolean(cfg.staticApiKey || cfg.tokenAuth || cfg.oauth);
}

/**
 * RFC 6750 challenge. `error="invalid_token"` only when a credential was
 * actually presented; `resource_metadata` (RFC 9728) only when OAuth is
 * configured, pointing at the origin-level PRM document.
 */
export function buildWwwAuthenticate(cfg: PrincipalAuthConfig, presented: boolean): string {
  const parts = ['realm="omnimind-mcp"'];
  if (presented) parts.push('error="invalid_token"');
  if (cfg.oauth && cfg.publicUrl) parts.push(`resource_metadata="${new URL(cfg.publicUrl).origin}${PRM_PATH}"`);
  return `Bearer ${parts.join(', ')}`;
}

/** RFC 9728 Protected Resource Metadata, or undefined when OAuth is not configured (→ 404). */
export function buildProtectedResourceMetadata(cfg: PrincipalAuthConfig): Record<string, unknown> | undefined {
  if (!cfg.oauth || !cfg.publicUrl) return undefined;
  return {
    resource: cfg.publicUrl,
    authorization_servers: [cfg.oauth.issuer],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ['header'],
    resource_documentation: cfg.docsUrl ?? DEFAULT_DOCS_URL,
  };
}

/**
 * True for the RFC 9728 paths this server answers: the origin-level document,
 * the `/mcp` path-scoped one, and either with a trailing slash — served
 * directly, never via a redirect (some clients drop `Authorization` or report
 * "Session terminated" on a 3xx).
 */
export function isProtectedResourceMetadataPath(pathname: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return p === PRM_PATH || p === `${PRM_PATH}/mcp`;
}

/** Constant-time comparison on equal-length (sha256) digests. */
export function credentialsMatch(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Cache key / log handle for a credential — never the credential itself. */
export function credentialDigest(credential: string): string {
  return createHash('sha256').update(credential).digest('hex');
}

/** Three base64url segments — a compact JWS. `omt_` tokens never match. */
export function looksLikeJwt(credential: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(credential);
}

const TOKEN_SHAPE = new RegExp(`^${TOKEN_PREFIX}[A-Za-z0-9_-]{${TOKEN_RANDOM_CHARS}}$`);

/**
 * M-4 — the exact shape BoardRoom mints (`omt_` + 43 base64url chars). Anything
 * else with the prefix is refused locally: no introspection round-trip, no
 * cache entry, so `omt_<nonce>` floods cost OmniMind nothing.
 */
export function isWellFormedToken(credential: string): boolean {
  return TOKEN_SHAPE.test(credential);
}

/** M-4 — a JWT we are willing to verify: three segments and at most `JWT_MAX_BYTES`. */
export function isWellFormedJwt(credential: string): boolean {
  return Buffer.byteLength(credential, 'utf8') <= JWT_MAX_BYTES && looksLikeJwt(credential);
}

function scopeGranted(scopes: readonly string[], required: string): boolean {
  if (scopes.includes('*') || scopes.includes(required)) return true;
  const [prefix] = required.split(':');
  return scopes.includes(`${prefix}:*`);
}

/**
 * Intersect a principal's stored scopes with the scopes an access token was
 * issued for (`scope` claim, space-delimited). Wildcards on either side grant
 * what they cover; a wildcard survives only when both sides carry it
 * literally. A present-but-empty claim yields no scopes.
 */
export function intersectScopes(principalScopes: readonly string[], tokenScopes: readonly string[]): string[] {
  const out = new Set<string>();
  for (const s of [...principalScopes, ...tokenScopes]) {
    if (s === '*' || s.endsWith(':*')) {
      if (principalScopes.includes(s) && tokenScopes.includes(s)) out.add(s);
      continue;
    }
    if (scopeGranted(principalScopes, s) && scopeGranted(tokenScopes, s)) out.add(s);
  }
  return [...out];
}

export function parseScopeClaim(payload: JWTPayload): string[] | undefined {
  const raw = payload.scope;
  if (typeof raw === 'string') return raw.split(/\s+/).map(s => s.trim()).filter(Boolean);
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === 'string');
  return undefined;
}

const MCP_SCOPE_PREFIXES = new Set(MCP_SCOPES.map(s => s.split(':')[0]));

/** An MCP scope (`memory:read`, …), the global wildcard, or an MCP-prefix wildcard (`memory:*`). */
export function isMcpScope(scope: string): boolean {
  if (scope === '*') return true;
  if ((MCP_SCOPES as readonly string[]).includes(scope)) return true;
  const m = /^([a-z]+):\*$/.exec(scope);
  return Boolean(m && MCP_SCOPE_PREFIXES.has(m[1]));
}

/**
 * L-2 — the MCP-relevant part of an OAuth `scope` claim. OIDC scopes
 * (`openid email profile offline_access`) are ignored; when nothing MCP-shaped
 * remains the claim is treated as absent (the identity's stored scopes apply)
 * instead of intersecting down to nothing.
 */
export function mcpScopesOfClaim(tokenScopes: readonly string[] | undefined): string[] | undefined {
  if (!tokenScopes) return undefined;
  const mcp = tokenScopes.filter(isMcpScope);
  return mcp.length > 0 ? mcp : undefined;
}

const McpPrincipalWireSchema = z.object({
  kind: z.enum(['token', 'oauth']),
  id: z.string().min(1),
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  agentName: z.string().min(1),
  scopes: z.array(z.string()),
  sourceWeight: z.number(),
  name: z.string().optional(),
  expiresAt: z.string().optional(),
});

/** Validate a principal returned by the API at the boundary (never trust the wire blindly). */
export function parsePrincipal(raw: unknown): McpPrincipal {
  const p = McpPrincipalWireSchema.parse(raw);
  return {
    kind: p.kind,
    id: p.id,
    userId: p.userId,
    tenantId: p.tenantId,
    agentName: p.agentName,
    scopes: p.scopes,
    sourceWeight: assertSourceWeight(p.sourceWeight, 'principal.sourceWeight'),
    ...(p.name ? { name: p.name } : {}),
    ...(p.expiresAt ? { expiresAt: p.expiresAt } : {}),
  };
}

/** The per-session AgentContext for a delegated caller. `agentId` is the principal's agent name; scopes are capped at `DELEGATED_SCOPE_CEILING` (L-6). */
export function agentContextFromPrincipal(principal: McpPrincipal): AgentContext {
  return {
    agentId: principal.agentName,
    agentName: principal.agentName,
    tenantId: principal.tenantId,
    scopes: intersectScopes(principal.scopes, DELEGATED_SCOPE_CEILING),
    sourceWeight: principal.sourceWeight,
    defaultUserId: principal.userId,
    principal,
  };
}

export type PrincipalResolution =
  | { ok: true; key: string; agentCtx: AgentContext }
  /** 401 — the credential is missing, malformed, unknown, expired, revoked, unlinked or bound to another audience. */
  | { ok: false; status: 401; error?: 'invalid_token'; reason: string }
  /** 503 — the credential could not be checked (OmniMind / issuer unreachable). Never cached. */
  | { ok: false; status: 503; reason: string };

export interface PrincipalResolverDeps {
  /** Env-derived identity for the static key (required when `staticApiKey` is set). */
  staticAgentCtx?: AgentContext;
  /** Gateway-level OmniMind client (static identity + `x-agent-key`). Required for token / OAuth modes. */
  gateway?: Pick<OmniMindClient, 'introspectToken' | 'resolveIdentity'>;
  /** Override the JWKS key getter (tests); otherwise `createRemoteJWKSet` from the configured / discovered URL. */
  jwks?: JWTVerifyGetKey;
  fetchFn?: typeof undiciFetch;
  now?: () => number;
  log?: (line: string) => void;
  /** Positive-cache TTL (default `resolvePrincipalCacheMs()` → 30 s). The HTTP app passes the env-derived value. */
  positiveTtlMs?: number;
}

export interface PrincipalResolver {
  resolve(credential: string | undefined): Promise<PrincipalResolution>;
  /**
   * True when the credential can be accepted without any upstream call (static
   * key match or a live positive cache entry). The HTTP layer uses it to keep
   * authenticated clients working while their IP's failure budget is exhausted.
   */
  isKnownGood(credential: string | undefined): boolean;
  /**
   * Drop every cached positive that resolved to this `kind:id` (one `omt_`
   * token, or every access token of one OAuth identity). The next request with
   * any of those credentials goes back to introspection / identity resolution,
   * which — after a revoke — refuses it. Returns how many entries were dropped.
   * Called by the HTTP transport when OmniMind answers `401 principal_invalid`.
   */
  evictPrincipal(principalKey: string): number;
  /** Drop one cached positive by credential digest (`credentialDigest(credential)`); true when it was present. */
  evictCredential(digest: string): boolean;
  /** The effective positive-cache TTL. */
  readonly positiveTtlMs: number;
  /** Number of cached resolutions, positive + negative (tests / diagnostics). */
  readonly cacheSize: number;
  /** Cached positives only (never evicted by a flood of negatives). */
  readonly positiveCacheSize: number;
  clearCache(): void;
}

/**
 * Canonical form of an issuer identifier for comparison only: scheme and host
 * lower-cased by the URL parser, default port dropped, trailing slashes
 * removed. `https://auth.example.test/` and `https://auth.example.test` are
 * the same issuer; a different host or path is not. Non-URL input is returned
 * trimmed of trailing slashes so a comparison still fails loudly.
 */
export function normalizeIssuer(issuer: string): string {
  const stripped = issuer.trim().replace(/\/+$/, '');
  try {
    const u = new URL(stripped);
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return stripped;
  }
}

/** True when both identify the same issuer modulo a trailing slash (see `normalizeIssuer`). */
export function issuersEqual(a: string, b: string): boolean {
  return normalizeIssuer(a) === normalizeIssuer(b);
}

/**
 * The `iss` values `jwtVerify` accepts for a configured issuer: the configured
 * string and its trailing-slash twin. Auth0 issues `https://<tenant>/` (with
 * the slash) while operators routinely configure the bare host; WorkOS and
 * most others issue without. Anything beyond the slash still has to match exactly.
 */
export function issuerVariants(issuer: string): string[] {
  const bare = issuer.replace(/\/+$/, '');
  return bare ? [bare, `${bare}/`] : [issuer];
}

/** The parts of an issuer's discovery document this server uses. */
export interface IssuerMetadata {
  jwksUri: string;
  /** Raw `userinfo_endpoint` when the document has one; validated (https) at use time. */
  userinfoEndpoint?: string;
}

/**
 * RFC 8414 / OIDC discovery — `/.well-known/openid-configuration` under the
 * issuer path, then `/.well-known/oauth-authorization-server`. L-3: the
 * document's `issuer` MUST identify the configured issuer (RFC 8414 §3.3,
 * trailing slash tolerated, host / path differences not) and the `jwks_uri`
 * must be https (loopback http allowed); a candidate that fails either check
 * is rejected, never silently used. The resolver caches the result.
 */
export async function discoverIssuerMetadata(issuer: string, fetchFn: typeof undiciFetch = undiciFetch): Promise<IssuerMetadata> {
  const u = new URL(issuer);
  const path = u.pathname.replace(/\/+$/, '');
  const candidates = [
    `${u.origin}${path}/.well-known/openid-configuration`,
    `${u.origin}/.well-known/oauth-authorization-server${path}`,
  ];
  const failures: string[] = [];
  for (const url of candidates) {
    try {
      const res = await fetchFn(url);
      if (!res.ok) {
        failures.push(`${url} → ${res.status}`);
        continue;
      }
      const meta = (await res.json()) as { jwks_uri?: unknown; issuer?: unknown; userinfo_endpoint?: unknown };
      if (typeof meta.issuer !== 'string' || !issuersEqual(meta.issuer, issuer)) {
        failures.push(`${url} → issuer mismatch (metadata says ${JSON.stringify(meta.issuer)})`);
        continue;
      }
      if (typeof meta.jwks_uri !== 'string' || !meta.jwks_uri) {
        failures.push(`${url} → no jwks_uri`);
        continue;
      }
      try {
        assertSecureUrl(meta.jwks_uri, 'jwks_uri');
      } catch (err) {
        failures.push(`${url} → ${(err as Error).message}`);
        continue;
      }
      const userinfoEndpoint = typeof meta.userinfo_endpoint === 'string' && meta.userinfo_endpoint ? meta.userinfo_endpoint : undefined;
      return { jwksUri: meta.jwks_uri, ...(userinfoEndpoint ? { userinfoEndpoint } : {}) };
    } catch (err) {
      failures.push(`${url} → ${(err as Error).message}`);
    }
  }
  throw new Error(`OAuth issuer metadata discovery failed for ${issuer}: ${failures.join('; ')}`);
}

/** Back-compat wrapper: the discovered `jwks_uri` only. */
export async function discoverJwksUri(issuer: string, fetchFn: typeof undiciFetch = undiciFetch): Promise<string> {
  return (await discoverIssuerMetadata(issuer, fetchFn)).jwksUri;
}

/** `email_verified` as providers actually send it: a boolean, or the strings "true" / "false". Anything else → unknown. */
export function parseEmailVerified(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (/^true$/i.test(v.trim())) return true;
    if (/^false$/i.test(v.trim())) return false;
  }
  return undefined;
}

/** What the userinfo fallback contributes to the identity claims (nothing when it failed or had no e-mail). */
export interface UserinfoClaims {
  email?: string;
  emailVerified?: boolean;
}

/** Log handle for an e-mail or subject — a sha256 prefix, never the value. */
function digestPrefix(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

/**
 * GET the issuer's userinfo endpoint with the access token being resolved.
 * Returns the e-mail claims only when the response is 200 JSON whose `sub`
 * equals the JWT `sub` (RFC 7662-style binding: a userinfo answer for another
 * subject is never attributed to this token). Any other outcome — non-2xx,
 * timeout, network error, unparsable body, mismatched `sub` — returns
 * `undefined` and the reason, so the caller can log once and fall back.
 */
export async function fetchUserinfo(
  endpoint: string,
  accessToken: string,
  expectedSub: string,
  fetchFn: typeof undiciFetch = undiciFetch,
  timeoutMs = USERINFO_TIMEOUT_MS
): Promise<{ claims?: UserinfoClaims; failure?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const res = await fetchFn(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return { failure: `userinfo_endpoint answered ${res.status}` };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { failure: 'userinfo_endpoint returned a non-JSON body' };
    }
    if (!body || typeof body !== 'object') return { failure: 'userinfo_endpoint returned a non-object body' };
    const info = body as { sub?: unknown; email?: unknown; email_verified?: unknown };
    if (typeof info.sub !== 'string' || info.sub !== expectedSub) {
      return { failure: `userinfo sub does not match the token sub (userinfo sub ${typeof info.sub === 'string' ? digestPrefix(info.sub) : 'absent'}…)` };
    }
    const claims: UserinfoClaims = {};
    if (typeof info.email === 'string' && info.email.trim()) claims.email = info.email.trim();
    const verified = parseEmailVerified(info.email_verified);
    if (verified !== undefined) claims.emailVerified = verified;
    return { claims };
  } catch (err) {
    const e = err as Error & { name?: string };
    return { failure: e.name === 'AbortError' ? `userinfo_endpoint timed out after ${timeoutMs} ms` : `userinfo_endpoint unreachable: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

export function createPrincipalResolver(cfg: PrincipalAuthConfig, deps: PrincipalResolverDeps = {}): PrincipalResolver {
  if (!hasAnyAuthMode(cfg)) throw new Error('createPrincipalResolver: no auth mode configured');
  if (cfg.staticApiKey && !deps.staticAgentCtx) throw new Error('createPrincipalResolver: staticAgentCtx is required when a static key is configured');
  if ((cfg.tokenAuth || cfg.oauth) && !deps.gateway) throw new Error('createPrincipalResolver: a gateway client is required for token / OAuth resolution');

  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? ((line: string) => console.log(line));
  const fetchFn = deps.fetchFn ?? undiciFetch;
  const positiveTtlMs = deps.positiveTtlMs ?? resolvePrincipalCacheMs();
  // M-4 — two maps: a flood of negative entries (unknown-but-well-formed tokens)
  // can evict only other negatives, never a live positive.
  const positives = new LruTtlCache<PrincipalResolution>(PRINCIPAL_CACHE_MAX_ENTRIES, positiveTtlMs, now);
  const negatives = new LruTtlCache<PrincipalResolution>(PRINCIPAL_CACHE_MAX_ENTRIES, PRINCIPAL_CACHE_NEGATIVE_MS, now);
  // principal `kind:id` → digests of the credentials currently cached for it,
  // so a `401 principal_invalid` on a data call can evict every credential of
  // that principal (several OAuth access tokens may map to one identity).
  // Pruned of dead digests whenever a principal gains a new entry, so it never
  // outgrows the positive cache by more than the entries the LRU dropped since.
  const digestsByPrincipal = new Map<string, Set<string>>();
  let warnedOidcOnlyScope = false;
  let warnedInsecureUserinfo = false;
  // Userinfo fallback results per (issuer, sub), successes and failures alike,
  // for the positive TTL: one GET per subject per window, never per request.
  const userinfoCache = new LruTtlCache<UserinfoClaims>(PRINCIPAL_CACHE_MAX_ENTRIES, positiveTtlMs, now);
  const userinfoKey = (issuer: string, sub: string) => `${issuer}\u0000${sub}`;

  function rememberPositive(digest: string, res: PrincipalResolution & { ok: true }, ttl: number): void {
    positives.set(digest, res, ttl);
    let set = digestsByPrincipal.get(res.key);
    if (!set) {
      set = new Set();
      digestsByPrincipal.set(res.key, set);
    } else {
      for (const d of set) if (!positives.has(d)) set.delete(d);
    }
    set.add(digest);
  }

  function evictCredential(digest: string): boolean {
    return positives.delete(digest);
  }

  function evictPrincipal(principalKey: string): number {
    const set = digestsByPrincipal.get(principalKey);
    if (!set) return 0;
    digestsByPrincipal.delete(principalKey);
    let dropped = 0;
    for (const d of set) if (positives.delete(d)) dropped++;
    return dropped;
  }

  // The discovery document is fetched once and cached for the life of the
  // process (a failure clears the slot so the next request retries). It feeds
  // both the JWKS (unless `OMNIMIND_MCP_OAUTH_JWKS_URL` is explicit) and the
  // userinfo endpoint.
  let metadataPromise: Promise<IssuerMetadata> | undefined;
  function getMetadata(): Promise<IssuerMetadata> {
    if (!metadataPromise) {
      const oauth = cfg.oauth as OAuthConfig;
      metadataPromise = discoverIssuerMetadata(oauth.issuer, fetchFn).catch(err => {
        metadataPromise = undefined; // retry discovery on the next request
        throw err;
      });
    }
    return metadataPromise;
  }

  let jwksPromise: Promise<JWTVerifyGetKey> | undefined;
  function getJwks(): Promise<JWTVerifyGetKey> {
    if (deps.jwks) return Promise.resolve(deps.jwks);
    if (!jwksPromise) {
      const oauth = cfg.oauth as OAuthConfig;
      jwksPromise = (oauth.jwksUrl ? Promise.resolve(oauth.jwksUrl) : getMetadata().then(m => m.jwksUri))
        .then(url => createRemoteJWKSet(new URL(url)))
        .catch(err => {
          jwksPromise = undefined; // retry discovery on the next request
          throw err;
        });
    }
    return jwksPromise;
  }

  /**
   * The userinfo fallback for one verified token: cached per (issuer, sub) for
   * the positive TTL; on a miss, discover the endpoint (https only), GET it
   * with the same access token, and keep whatever e-mail claims it yields.
   * Every failure is cached as "no claims" and logged once per subject per
   * window — never the e-mail, only sha256 prefixes.
   */
  async function userinfoClaimsFor(token: string, sub: string): Promise<UserinfoClaims> {
    const oauth = cfg.oauth as OAuthConfig;
    const key = userinfoKey(oauth.issuer, sub);
    const cached = userinfoCache.get(key);
    if (cached) return cached;
    const subHandle = digestPrefix(sub);
    let outcome: UserinfoClaims = {};
    let failure: string | undefined;
    let endpoint: string | undefined;
    try {
      endpoint = (await getMetadata()).userinfoEndpoint;
    } catch (err) {
      failure = `issuer metadata unavailable: ${(err as Error).message}`;
    }
    if (!failure && !endpoint) failure = 'issuer metadata has no userinfo_endpoint';
    if (!failure && endpoint) {
      try {
        assertSecureUrl(endpoint, 'userinfo_endpoint');
      } catch (err) {
        failure = (err as Error).message;
        if (!warnedInsecureUserinfo) {
          warnedInsecureUserinfo = true;
          log(`[omnimind-mcp] OAuth userinfo fallback disabled: ${failure}`);
        }
      }
    }
    if (!failure && endpoint) {
      const res = await fetchUserinfo(endpoint, token, sub, fetchFn);
      if (res.claims) outcome = res.claims;
      else failure = res.failure ?? 'userinfo failed';
    }
    userinfoCache.set(key, outcome, positiveTtlMs);
    if (failure) {
      log(`[omnimind-mcp] OAuth userinfo fallback for subject ${subHandle}… yielded nothing (${failure}); the token has no verified e-mail, so auto-link cannot fire — link the identity manually or set ${OAUTH_USERINFO_ENV}=false to stop trying`);
    } else if (outcome.email) {
      log(`[omnimind-mcp] OAuth userinfo supplied e-mail ${digestPrefix(outcome.email)}… (verified: ${outcome.emailVerified === true}) for subject ${subHandle}…`);
    } else {
      log(`[omnimind-mcp] OAuth userinfo for subject ${subHandle}… carries no e-mail; auto-link cannot fire`);
    }
    return outcome;
  }

  function invalid(reason: string): PrincipalResolution {
    return { ok: false, status: 401, error: 'invalid_token', reason };
  }

  function unavailable(reason: string): PrincipalResolution {
    return { ok: false, status: 503, reason };
  }

  function accept(principal: McpPrincipal): PrincipalResolution {
    if (principal.expiresAt && Date.parse(principal.expiresAt) <= now()) return invalid('expired');
    return { ok: true, key: principalKeyOf(principal), agentCtx: agentContextFromPrincipal(principal) };
  }

  /** TTL for a positive entry — the configured TTL (30 s default), or less when the principal expires sooner. */
  function positiveTtl(res: PrincipalResolution): number {
    if (!res.ok) return PRINCIPAL_CACHE_NEGATIVE_MS;
    const exp = res.agentCtx.principal?.expiresAt;
    if (!exp) return positiveTtlMs;
    return Math.max(0, Math.min(positiveTtlMs, Date.parse(exp) - now()));
  }

  /**
   * M-4 — how an upstream failure of introspection / identity resolution maps:
   * network error or 5xx → 503 (never cached); 401 / 403 → the GATEWAY key is
   * wrong or lacks `mcp:delegate` — also 503, loudly, because the presented
   * credential was never checked; any other 4xx (the API refused the request
   * itself: shape, size, schema) → `invalid_token`, cached negatively.
   */
  function upstreamFailure(what: string, err: unknown): PrincipalResolution {
    if (err instanceof OmniMindHttpError) {
      if (err.status === 401 || err.status === 403) {
        log(`[omnimind-mcp] ${what} refused by OmniMind (${err.status}): check OMNIMIND_MCP_AGENT_KEY (gateway key with scope mcp:delegate)`);
        return unavailable(`${what} unavailable`);
      }
      if (err.status >= 400 && err.status < 500) {
        log(`[omnimind-mcp] ${what} rejected the credential (${err.status})`);
        return invalid('invalid');
      }
    }
    log(`[omnimind-mcp] ${what} unavailable: ${(err as Error).message}`);
    return unavailable(`${what} unavailable`);
  }

  async function resolveToken(token: string): Promise<PrincipalResolution> {
    let result: IntrospectResult;
    try {
      result = await (deps.gateway as NonNullable<PrincipalResolverDeps['gateway']>).introspectToken(token);
    } catch (err) {
      return upstreamFailure('token introspection', err);
    }
    if (!result || typeof result !== 'object') return unavailable('token introspection returned no body');
    if (!result.active) return invalid(typeof result.reason === 'string' ? result.reason : 'invalid');
    try {
      return accept(parsePrincipal(result.principal));
    } catch (err) {
      log(`[omnimind-mcp] token introspection returned an invalid principal: ${(err as Error).message}`);
      return unavailable('token introspection returned an invalid principal');
    }
  }

  async function resolveJwt(token: string): Promise<PrincipalResolution> {
    const oauth = cfg.oauth as OAuthConfig;
    let jwks: JWTVerifyGetKey;
    try {
      jwks = await getJwks();
    } catch (err) {
      log(`[omnimind-mcp] OAuth JWKS unavailable: ${(err as Error).message}`);
      return unavailable('authorization server keys unavailable');
    }
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, jwks, {
        issuer: issuerVariants(oauth.issuer),
        audience: oauth.audience,
        algorithms: [...OAUTH_ALGORITHMS],
        requiredClaims: ['exp', 'sub'],
        clockTolerance: JWT_CLOCK_TOLERANCE_S,
      }));
    } catch (err) {
      if (err instanceof joseErrors.JWKSTimeout) return unavailable('authorization server keys unavailable');
      if (err instanceof joseErrors.JOSEError) return invalid(err.code === 'ERR_JWT_EXPIRED' ? 'expired' : err.code.toLowerCase());
      log(`[omnimind-mcp] OAuth verification failed unexpectedly: ${(err as Error).message}`);
      return unavailable('authorization server keys unavailable');
    }

    const subject = payload.sub as string;
    let email = typeof payload.email === 'string' && payload.email.trim() ? payload.email.trim() : undefined;
    let emailVerified = parseEmailVerified(payload.email_verified);
    if (oauth.userinfo !== false && !(email && emailVerified === true)) {
      // The token itself cannot auto-link; ask the issuer who this is.
      const extra = await userinfoClaimsFor(token, subject);
      if (extra.email) {
        email = extra.email;
        emailVerified = extra.emailVerified;
      }
    }
    const claims: IdentityClaims = {
      issuer: oauth.issuer,
      subject,
      ...(email ? { email } : {}),
      ...(emailVerified !== undefined ? { emailVerified } : {}),
    };
    const clientId = typeof payload.azp === 'string' ? payload.azp : typeof payload.client_id === 'string' ? payload.client_id : undefined;
    if (clientId) claims.clientId = clientId;

    let result: ResolveIdentityResult;
    try {
      result = await (deps.gateway as NonNullable<PrincipalResolverDeps['gateway']>).resolveIdentity(claims);
    } catch (err) {
      return upstreamFailure('identity resolution', err);
    }
    if (!result || typeof result !== 'object') return unavailable('identity resolution returned no body');
    if (!result.active) return invalid(typeof result.reason === 'string' ? result.reason : 'unlinked');
    let principal: McpPrincipal;
    try {
      principal = parsePrincipal(result.principal);
    } catch (err) {
      log(`[omnimind-mcp] identity resolution returned an invalid principal: ${(err as Error).message}`);
      return unavailable('identity resolution returned an invalid principal');
    }
    const claimScopes = parseScopeClaim(payload);
    const tokenScopes = mcpScopesOfClaim(claimScopes);
    if (tokenScopes) {
      principal = { ...principal, scopes: intersectScopes(principal.scopes, tokenScopes) };
    } else if (claimScopes && !warnedOidcOnlyScope) {
      warnedOidcOnlyScope = true;
      log('[omnimind-mcp] OAuth access token carries a scope claim with no MCP scopes (e.g. "openid email profile"); using the linked identity\'s stored scopes. Mint memory:* scopes at the authorization server to narrow per client.');
    }
    // Cap the cached lifetime at the token's own expiry.
    const expMs = typeof payload.exp === 'number' ? payload.exp * 1000 : undefined;
    if (expMs !== undefined && (!principal.expiresAt || Date.parse(principal.expiresAt) > expMs)) {
      principal = { ...principal, expiresAt: new Date(expMs).toISOString() };
    }
    return accept(principal);
  }

  /** A cached positive, unless the principal crossed its own expiry inside the window (then demoted to a negative). */
  function cachedPositive(digest: string): PrincipalResolution | undefined {
    const cached = positives.get(digest);
    if (!cached || !cached.ok) return undefined;
    const exp = cached.agentCtx.principal?.expiresAt;
    if (exp && Date.parse(exp) <= now()) {
      negatives.set(digest, invalid('expired'));
      return undefined;
    }
    return cached;
  }

  function isKnownGood(credential: string | undefined): boolean {
    if (!credential) return false;
    if (cfg.staticApiKey && credentialsMatch(credential, cfg.staticApiKey)) return true;
    const isToken = credential.startsWith(TOKEN_PREFIX);
    if (isToken ? !isWellFormedToken(credential) : !isWellFormedJwt(credential)) return false;
    return cachedPositive(credentialDigest(credential)) !== undefined;
  }

  async function resolve(credential: string | undefined): Promise<PrincipalResolution> {
    if (!credential) return { ok: false, status: 401, reason: 'no credential presented' };

    if (cfg.staticApiKey && credentialsMatch(credential, cfg.staticApiKey)) {
      return { ok: true, key: STATIC_PRINCIPAL_KEY, agentCtx: deps.staticAgentCtx as AgentContext };
    }

    const isToken = credential.startsWith(TOKEN_PREFIX);
    const isJwt = !isToken && looksLikeJwt(credential);
    if (isToken && !cfg.tokenAuth) return invalid('token auth is not enabled on this server');
    if (isJwt && !cfg.oauth) return invalid('oauth is not enabled on this server');
    if (!isToken && !isJwt) return invalid('unrecognized credential');
    // M-4 — shape first: a malformed credential never reaches the network or the cache.
    if (isToken && !isWellFormedToken(credential)) return invalid('malformed token');
    if (isJwt && !isWellFormedJwt(credential)) return invalid('malformed jwt');

    const digest = credentialDigest(credential);
    const positive = cachedPositive(digest);
    if (positive) return positive;
    const negative = negatives.get(digest);
    if (negative) return negative;

    const fresh = isToken ? await resolveToken(credential) : await resolveJwt(credential);
    if (fresh.ok) rememberPositive(digest, fresh, positiveTtl(fresh));
    else if (fresh.status === 401) negatives.set(digest, fresh, PRINCIPAL_CACHE_NEGATIVE_MS);
    return fresh;
  }

  return {
    resolve,
    isKnownGood,
    evictPrincipal,
    evictCredential,
    positiveTtlMs,
    get cacheSize() {
      return positives.size + negatives.size;
    },
    get positiveCacheSize() {
      return positives.size;
    },
    clearCache: () => {
      positives.clear();
      negatives.clear();
      digestsByPrincipal.clear();
      userinfoCache.clear();
    },
  };
}
