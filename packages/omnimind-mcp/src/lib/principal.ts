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
 * Results are cached for 60 s (positive) / 10 s (negative) under the sha256 of
 * the credential; the raw credential is never logged or used as a key.
 * Introspection and identity resolution are made by the GATEWAY client
 * (static identity + `x-agent-key` with scope `mcp:delegate`), never by a
 * per-session delegated client.
 */
import { createHash, timingSafeEqual } from 'crypto';
import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { fetch as undiciFetch } from 'undici';
import { z } from 'zod';
import { assertSourceWeight } from './auth';
import { LruTtlCache } from './replay-cache';
import type { IdentityClaims, IntrospectResult, OmniMindClient, ResolveIdentityResult } from './client';
import { principalKeyOf } from '../types';
import type { AgentContext, McpPrincipal } from '../types';

/** Every scope an OmniMind agent / token / identity can hold (advertised in the PRM document). */
export const MCP_SCOPES = ['memory:read', 'memory:write', 'decision:write', 'task:write', 'project:write', 'commitment:write'] as const;
/** JWS algorithm allowlist for OAuth access tokens — asymmetric only, never HS*. */
export const OAUTH_ALGORITHMS = ['RS256', 'ES256', 'EdDSA'] as const;
export const PRINCIPAL_CACHE_POSITIVE_MS = 60_000;
export const PRINCIPAL_CACHE_NEGATIVE_MS = 10_000;
export const PRINCIPAL_CACHE_MAX_ENTRIES = 2_000;
/** Session-binding key of the legacy static credential (one identity per process). */
export const STATIC_PRINCIPAL_KEY = 'static:env';
export const TOKEN_PREFIX = 'omt_';
/** RFC 9728 well-known path; also served with the `/mcp` suffix for path-scoped resources. */
export const PRM_PATH = '/.well-known/oauth-protected-resource';
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

function isTrue(v: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(v?.trim() ?? '');
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
    assertHttpUrl(issuer, 'OMNIMIND_MCP_OAUTH_ISSUER');
    if (!agentKey) throw new Error('OMNIMIND_MCP_OAUTH_ISSUER requires OMNIMIND_MCP_AGENT_KEY (identity resolution is a delegated call).');
    const audience = trimmed(env.OMNIMIND_MCP_OAUTH_AUDIENCE) ?? publicUrl;
    if (!audience || !publicUrl) {
      throw new Error('OMNIMIND_MCP_OAUTH_ISSUER requires OMNIMIND_MCP_PUBLIC_URL (the resource identifier clients bind tokens to; OMNIMIND_MCP_OAUTH_AUDIENCE may override the expected aud).');
    }
    const jwksUrl = trimmed(env.OMNIMIND_MCP_OAUTH_JWKS_URL);
    if (jwksUrl) assertHttpUrl(jwksUrl, 'OMNIMIND_MCP_OAUTH_JWKS_URL');
    oauth = { issuer, audience, ...(jwksUrl ? { jwksUrl } : {}) };
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
  if (cfg.oauth) modes.push(`OAuth (issuer ${cfg.oauth.issuer}, audience ${cfg.oauth.audience})`);
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

/** True for the two RFC 9728 paths this server answers. */
export function isProtectedResourceMetadataPath(pathname: string): boolean {
  return pathname === PRM_PATH || pathname === `${PRM_PATH}/mcp`;
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

/** The per-session AgentContext for a delegated caller. `agentId` is the principal's agent name. */
export function agentContextFromPrincipal(principal: McpPrincipal): AgentContext {
  return {
    agentId: principal.agentName,
    agentName: principal.agentName,
    tenantId: principal.tenantId,
    scopes: [...principal.scopes],
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
}

export interface PrincipalResolver {
  resolve(credential: string | undefined): Promise<PrincipalResolution>;
  /** Number of cached resolutions (tests / diagnostics). */
  readonly cacheSize: number;
  clearCache(): void;
}

/** RFC 8414 / OIDC discovery — returns the issuer's `jwks_uri`. */
export async function discoverJwksUri(issuer: string, fetchFn: typeof undiciFetch = undiciFetch): Promise<string> {
  const u = new URL(issuer);
  const path = u.pathname.replace(/\/$/, '');
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
      const meta = (await res.json()) as { jwks_uri?: unknown; issuer?: unknown };
      if (typeof meta.jwks_uri !== 'string' || !meta.jwks_uri) {
        failures.push(`${url} → no jwks_uri`);
        continue;
      }
      return meta.jwks_uri;
    } catch (err) {
      failures.push(`${url} → ${(err as Error).message}`);
    }
  }
  throw new Error(`OAuth issuer metadata discovery failed for ${issuer}: ${failures.join('; ')}`);
}

export function createPrincipalResolver(cfg: PrincipalAuthConfig, deps: PrincipalResolverDeps = {}): PrincipalResolver {
  if (!hasAnyAuthMode(cfg)) throw new Error('createPrincipalResolver: no auth mode configured');
  if (cfg.staticApiKey && !deps.staticAgentCtx) throw new Error('createPrincipalResolver: staticAgentCtx is required when a static key is configured');
  if ((cfg.tokenAuth || cfg.oauth) && !deps.gateway) throw new Error('createPrincipalResolver: a gateway client is required for token / OAuth resolution');

  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? ((line: string) => console.log(line));
  const fetchFn = deps.fetchFn ?? undiciFetch;
  const cache = new LruTtlCache<PrincipalResolution>(PRINCIPAL_CACHE_MAX_ENTRIES, PRINCIPAL_CACHE_POSITIVE_MS, now);

  let jwksPromise: Promise<JWTVerifyGetKey> | undefined;
  function getJwks(): Promise<JWTVerifyGetKey> {
    if (deps.jwks) return Promise.resolve(deps.jwks);
    if (!jwksPromise) {
      const oauth = cfg.oauth as OAuthConfig;
      jwksPromise = (oauth.jwksUrl ? Promise.resolve(oauth.jwksUrl) : discoverJwksUri(oauth.issuer, fetchFn))
        .then(url => createRemoteJWKSet(new URL(url)))
        .catch(err => {
          jwksPromise = undefined; // retry discovery on the next request
          throw err;
        });
    }
    return jwksPromise;
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

  /** TTL for a positive entry — 60 s, or less when the principal expires sooner. */
  function positiveTtl(res: PrincipalResolution): number {
    if (!res.ok) return PRINCIPAL_CACHE_NEGATIVE_MS;
    const exp = res.agentCtx.principal?.expiresAt;
    if (!exp) return PRINCIPAL_CACHE_POSITIVE_MS;
    return Math.max(0, Math.min(PRINCIPAL_CACHE_POSITIVE_MS, Date.parse(exp) - now()));
  }

  async function resolveToken(token: string): Promise<PrincipalResolution> {
    let result: IntrospectResult;
    try {
      result = await (deps.gateway as NonNullable<PrincipalResolverDeps['gateway']>).introspectToken(token);
    } catch (err) {
      log(`[omnimind-mcp] token introspection unavailable: ${(err as Error).message}`);
      return unavailable('token introspection unavailable');
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
        issuer: oauth.issuer,
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

    const claims: IdentityClaims = {
      issuer: oauth.issuer,
      subject: payload.sub as string,
      ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
      ...(typeof payload.email_verified === 'boolean' ? { emailVerified: payload.email_verified } : {}),
    };
    const clientId = typeof payload.azp === 'string' ? payload.azp : typeof payload.client_id === 'string' ? payload.client_id : undefined;
    if (clientId) claims.clientId = clientId;

    let result: ResolveIdentityResult;
    try {
      result = await (deps.gateway as NonNullable<PrincipalResolverDeps['gateway']>).resolveIdentity(claims);
    } catch (err) {
      log(`[omnimind-mcp] identity resolution unavailable: ${(err as Error).message}`);
      return unavailable('identity resolution unavailable');
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
    const tokenScopes = parseScopeClaim(payload);
    if (tokenScopes) principal = { ...principal, scopes: intersectScopes(principal.scopes, tokenScopes) };
    // Cap the cached lifetime at the token's own expiry.
    const expMs = typeof payload.exp === 'number' ? payload.exp * 1000 : undefined;
    if (expMs !== undefined && (!principal.expiresAt || Date.parse(principal.expiresAt) > expMs)) {
      principal = { ...principal, expiresAt: new Date(expMs).toISOString() };
    }
    return accept(principal);
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

    const digest = credentialDigest(credential);
    const cached = cache.get(digest);
    if (cached) {
      // A cached positive may have crossed the principal's own expiry inside the 60 s window.
      if (cached.ok && cached.agentCtx.principal?.expiresAt && Date.parse(cached.agentCtx.principal.expiresAt) <= now()) {
        cache.set(digest, invalid('expired'), PRINCIPAL_CACHE_NEGATIVE_MS);
        return invalid('expired');
      }
      return cached;
    }

    const fresh = isToken ? await resolveToken(credential) : await resolveJwt(credential);
    if (fresh.ok || fresh.status === 401) cache.set(digest, fresh, positiveTtl(fresh));
    return fresh;
  }

  return {
    resolve,
    get cacheSize() {
      return cache.size;
    },
    clearCache: () => cache.clear(),
  };
}
