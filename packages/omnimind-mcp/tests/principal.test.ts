/**
 * Front door — principal resolution unit tests: env config, RFC 6750 / 9728
 * builders, scope intersection, and `createPrincipalResolver` for the three
 * credential types with a mocked gateway client and an in-test JWKS.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK, type CryptoKey } from 'jose';
import { MCP_SCOPES as SHARED_MCP_SCOPES } from '@boardroom/shared';
import {
  resolvePrincipalAuthConfig, buildWwwAuthenticate, buildProtectedResourceMetadata, isProtectedResourceMetadataPath,
  intersectScopes, looksLikeJwt, credentialDigest, parsePrincipal, agentContextFromPrincipal, createPrincipalResolver, DELEGATED_SCOPE_CEILING,
  isWellFormedToken, isWellFormedJwt, isMcpScope, mcpScopesOfClaim, discoverJwksUri, assertSecureUrl, isLoopbackHost,
  MCP_SCOPES, STATIC_PRINCIPAL_KEY, PRM_PATH, DEFAULT_DOCS_URL, PRINCIPAL_CACHE_POSITIVE_MS, PRINCIPAL_CACHE_NEGATIVE_MS,
  PRINCIPAL_CACHE_MAX_ENTRIES, TOKEN_RANDOM_CHARS, JWT_MAX_BYTES,
  type PrincipalAuthConfig,
} from '../src/lib/principal';
import { OmniMindHttpError } from '../src/lib/client';
import type { AgentContext } from '../src/types';

const PUBLIC_URL = 'https://mcp.example.test/mcp';
const ISSUER = 'https://auth.example.test';

/** A well-formed `omt_` token (prefix + 43 base64url chars) that is stable per name. */
export function omt(name: string): string {
  return `omt_${createHash('sha256').update(name).digest('base64url').slice(0, TOKEN_RANDOM_CHARS)}`;
}
const OMT_ALICE = omt('alice');
const OMT_DEAD = omt('dead');
const OMT_OUTAGE = omt('outage');

const staticCtx: AgentContext = { agentId: 'env-agent', agentName: 'env-agent', tenantId: 'josh-business', scopes: ['memory:read'], sourceWeight: 1 };

const alice = { kind: 'token' as const, id: 'tok_alice', userId: 'user-alice', tenantId: 'josh-business', agentName: 'claude-ai-alice', scopes: ['memory:read', 'memory:write'], sourceWeight: 0.8, name: 'Alice laptop' };
const carol = { kind: 'oauth' as const, id: 'oid_carol', userId: 'user-carol', tenantId: 'josh-business', agentName: 'chatgpt-carol', scopes: ['*'], sourceWeight: 1 };

describe('resolvePrincipalAuthConfig (env)', () => {
  it('refuses to start with nothing configured, naming OMNIMIND_MCP_API_KEY', () => {
    expect(() => resolvePrincipalAuthConfig({} as NodeJS.ProcessEnv)).toThrow(/OMNIMIND_MCP_API_KEY is required/);
  });

  it('token auth requires the gateway agent key; OAuth requires agent key + public URL', () => {
    expect(() => resolvePrincipalAuthConfig({ OMNIMIND_MCP_TOKEN_AUTH: 'true' } as NodeJS.ProcessEnv)).toThrow(/OMNIMIND_MCP_AGENT_KEY/);
    expect(() => resolvePrincipalAuthConfig({ OMNIMIND_MCP_OAUTH_ISSUER: ISSUER, OMNIMIND_MCP_AGENT_KEY: 'omk_gw' } as NodeJS.ProcessEnv)).toThrow(/OMNIMIND_MCP_PUBLIC_URL/);
    expect(() => resolvePrincipalAuthConfig({ OMNIMIND_MCP_OAUTH_ISSUER: ISSUER, OMNIMIND_MCP_PUBLIC_URL: PUBLIC_URL } as NodeJS.ProcessEnv)).toThrow(/OMNIMIND_MCP_AGENT_KEY/);
    expect(() => resolvePrincipalAuthConfig({ OMNIMIND_MCP_OAUTH_ISSUER: 'not a url', OMNIMIND_MCP_PUBLIC_URL: PUBLIC_URL, OMNIMIND_MCP_AGENT_KEY: 'k' } as NodeJS.ProcessEnv)).toThrow(/absolute http/);
  });

  it('accepts each mode alone and all three together; audience defaults to the public URL', () => {
    expect(resolvePrincipalAuthConfig({ OMNIMIND_MCP_API_KEY: 'k' } as NodeJS.ProcessEnv)).toEqual({ staticApiKey: 'k', tokenAuth: false });
    expect(resolvePrincipalAuthConfig({ OMNIMIND_MCP_TOKEN_AUTH: 'true', OMNIMIND_MCP_AGENT_KEY: 'omk_gw' } as NodeJS.ProcessEnv)).toEqual({ tokenAuth: true, agentKey: 'omk_gw' });
    const all = resolvePrincipalAuthConfig({
      OMNIMIND_MCP_API_KEY: 'k', OMNIMIND_MCP_TOKEN_AUTH: '1', OMNIMIND_MCP_AGENT_KEY: 'omk_gw',
      OMNIMIND_MCP_OAUTH_ISSUER: ISSUER, OMNIMIND_MCP_PUBLIC_URL: PUBLIC_URL, OMNIMIND_MCP_OAUTH_JWKS_URL: `${ISSUER}/keys`,
    } as NodeJS.ProcessEnv);
    expect(all).toEqual({ staticApiKey: 'k', tokenAuth: true, agentKey: 'omk_gw', publicUrl: PUBLIC_URL, oauth: { issuer: ISSUER, audience: PUBLIC_URL, jwksUrl: `${ISSUER}/keys` } });
    const overridden = resolvePrincipalAuthConfig({ OMNIMIND_MCP_OAUTH_ISSUER: ISSUER, OMNIMIND_MCP_PUBLIC_URL: PUBLIC_URL, OMNIMIND_MCP_AGENT_KEY: 'k', OMNIMIND_MCP_OAUTH_AUDIENCE: 'urn:omnimind:mcp' } as NodeJS.ProcessEnv);
    expect(overridden.oauth?.audience).toBe('urn:omnimind:mcp');
  });
});

describe('RFC 6750 challenge + RFC 9728 metadata', () => {
  const noOauth: PrincipalAuthConfig = { staticApiKey: 'k', tokenAuth: false };
  const withOauth: PrincipalAuthConfig = { tokenAuth: true, agentKey: 'g', publicUrl: PUBLIC_URL, oauth: { issuer: ISSUER, audience: PUBLIC_URL } };

  it('omits error= when nothing was presented and resource_metadata when OAuth is off', () => {
    expect(buildWwwAuthenticate(noOauth, false)).toBe('Bearer realm="omnimind-mcp"');
    expect(buildWwwAuthenticate(noOauth, true)).toBe('Bearer realm="omnimind-mcp", error="invalid_token"');
    expect(buildWwwAuthenticate(withOauth, false)).toBe(`Bearer realm="omnimind-mcp", resource_metadata="https://mcp.example.test${PRM_PATH}"`);
    expect(buildWwwAuthenticate(withOauth, true)).toBe(`Bearer realm="omnimind-mcp", error="invalid_token", resource_metadata="https://mcp.example.test${PRM_PATH}"`);
  });

  it('PRM document lists the issuer, every MCP scope and header bearer only; absent without OAuth', () => {
    // scopes_supported is the shared vocabulary (incl. code:write), not a local copy.
    expect([...MCP_SCOPES]).toEqual([...SHARED_MCP_SCOPES]);
    expect(MCP_SCOPES).toContain('code:write');
    expect(buildProtectedResourceMetadata(noOauth)).toBeUndefined();
    expect(buildProtectedResourceMetadata(withOauth)).toEqual({
      resource: PUBLIC_URL,
      authorization_servers: [ISSUER],
      scopes_supported: [...MCP_SCOPES],
      bearer_methods_supported: ['header'],
      resource_documentation: DEFAULT_DOCS_URL,
    });
    expect(buildProtectedResourceMetadata({ ...withOauth, docsUrl: 'https://docs.example.test' })?.resource_documentation).toBe('https://docs.example.test');
    expect(isProtectedResourceMetadataPath(PRM_PATH)).toBe(true);
    expect(isProtectedResourceMetadataPath(`${PRM_PATH}/mcp`)).toBe(true);
    expect(isProtectedResourceMetadataPath('/.well-known/openid-configuration')).toBe(false);
  });
});

describe('scopes / credential shape helpers', () => {
  it('intersectScopes keeps only what both sides grant, honouring wildcards', () => {
    expect(intersectScopes(['*'], ['memory:read'])).toEqual(['memory:read']);
    expect(intersectScopes(['memory:read', 'memory:write', 'task:write'], ['memory:*'])).toEqual(['memory:read', 'memory:write']);
    expect(intersectScopes(['memory:read'], ['memory:read', 'task:write'])).toEqual(['memory:read']);
    expect(intersectScopes(['*'], ['*'])).toEqual(['*']);
    expect(intersectScopes(['memory:read'], [])).toEqual([]);
  });

  it('looksLikeJwt / credentialDigest', () => {
    expect(looksLikeJwt('aaa.bbb.ccc')).toBe(true);
    expect(looksLikeJwt('omt_abc')).toBe(false);
    expect(looksLikeJwt('a.b')).toBe(false);
    expect(credentialDigest('secret')).toMatch(/^[0-9a-f]{64}$/);
    expect(credentialDigest('secret')).not.toContain('secret');
  });

  it('M-4: isWellFormedToken is exactly omt_ + 43 base64url chars; isWellFormedJwt caps at 8 KiB', () => {
    expect(TOKEN_RANDOM_CHARS).toBe(43);
    expect(isWellFormedToken(OMT_ALICE)).toBe(true);
    expect(isWellFormedToken('omt_alice')).toBe(false);
    expect(isWellFormedToken(`${OMT_ALICE}x`)).toBe(false);
    expect(isWellFormedToken(`omt_${'a'.repeat(42)}+`)).toBe(false);
    expect(isWellFormedToken(`omt_${'a'.repeat(300)}`)).toBe(false);
    expect(isWellFormedJwt('aaa.bbb.ccc')).toBe(true);
    expect(isWellFormedJwt(`${'a'.repeat(JWT_MAX_BYTES)}.b.c`)).toBe(false);
    expect(isWellFormedJwt('a.b')).toBe(false);
  });

  it('L-2: an OAuth scope claim is reduced to its MCP scopes; OIDC-only claims count as absent', () => {
    expect(isMcpScope('memory:read')).toBe(true);
    expect(isMcpScope('memory:*')).toBe(true);
    expect(isMcpScope('*')).toBe(true);
    expect(isMcpScope('openid')).toBe(false);
    expect(isMcpScope('files:*')).toBe(false);
    expect(mcpScopesOfClaim(['openid', 'email', 'profile'])).toBeUndefined();
    expect(mcpScopesOfClaim(['openid', 'memory:read', 'offline_access'])).toEqual(['memory:read']);
    expect(mcpScopesOfClaim(undefined)).toBeUndefined();
  });

  it('L-3: authorization-server URLs must be https except on loopback', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('auth.example.test')).toBe(false);
    expect(assertSecureUrl('https://auth.example.test', 'x')).toBe('https://auth.example.test');
    expect(assertSecureUrl('http://localhost:9000', 'x')).toBe('http://localhost:9000');
    expect(assertSecureUrl('http://127.0.0.1:9000/realm', 'x')).toBe('http://127.0.0.1:9000/realm');
    expect(() => assertSecureUrl('http://auth.example.test', 'OMNIMIND_MCP_OAUTH_ISSUER')).toThrow(/must use https/);
    expect(() => resolvePrincipalAuthConfig({ OMNIMIND_MCP_OAUTH_ISSUER: 'http://auth.example.test', OMNIMIND_MCP_PUBLIC_URL: PUBLIC_URL, OMNIMIND_MCP_AGENT_KEY: 'k' } as NodeJS.ProcessEnv)).toThrow(/must use https/);
    expect(() => resolvePrincipalAuthConfig({ OMNIMIND_MCP_OAUTH_ISSUER: ISSUER, OMNIMIND_MCP_OAUTH_JWKS_URL: 'http://keys.example.test/jwks', OMNIMIND_MCP_PUBLIC_URL: PUBLIC_URL, OMNIMIND_MCP_AGENT_KEY: 'k' } as NodeJS.ProcessEnv)).toThrow(/OMNIMIND_MCP_OAUTH_JWKS_URL must use https/);
    expect(resolvePrincipalAuthConfig({ OMNIMIND_MCP_OAUTH_ISSUER: 'http://localhost:9000', OMNIMIND_MCP_PUBLIC_URL: PUBLIC_URL, OMNIMIND_MCP_AGENT_KEY: 'k' } as NodeJS.ProcessEnv).oauth?.issuer).toBe('http://localhost:9000');
  });

  it('L-3: discovery rejects metadata whose issuer differs or whose jwks_uri is plain http off loopback', async () => {
    const fetchFor = (meta: Record<string, unknown>) => (async () => ({ ok: true, status: 200, json: async () => meta })) as never;
    await expect(discoverJwksUri(ISSUER, fetchFor({ issuer: ISSUER, jwks_uri: `${ISSUER}/jwks` }))).resolves.toBe(`${ISSUER}/jwks`);
    await expect(discoverJwksUri(`${ISSUER}/`, fetchFor({ issuer: ISSUER, jwks_uri: `${ISSUER}/jwks` }))).resolves.toBe(`${ISSUER}/jwks`);
    await expect(discoverJwksUri(ISSUER, fetchFor({ issuer: 'https://evil.example.test', jwks_uri: `${ISSUER}/jwks` }))).rejects.toThrow(/issuer mismatch/);
    await expect(discoverJwksUri(ISSUER, fetchFor({ jwks_uri: `${ISSUER}/jwks` }))).rejects.toThrow(/issuer mismatch/);
    await expect(discoverJwksUri(ISSUER, fetchFor({ issuer: ISSUER, jwks_uri: 'http://keys.example.test/jwks' }))).rejects.toThrow(/jwks_uri must use https/);
    await expect(discoverJwksUri('http://127.0.0.1:9', fetchFor({ issuer: 'http://127.0.0.1:9', jwks_uri: 'http://127.0.0.1:9/jwks' }))).resolves.toBe('http://127.0.0.1:9/jwks');
  });

  it('parsePrincipal validates the wire shape and the source weight range', () => {
    expect(parsePrincipal(alice)).toEqual(alice);
    expect(() => parsePrincipal({ ...alice, sourceWeight: 9 })).toThrow(/between 0 and 2/);
    expect(() => parsePrincipal({ ...alice, kind: 'static' })).toThrow();
    expect(() => parsePrincipal({ ...alice, userId: '' })).toThrow();
    const ctx = agentContextFromPrincipal(alice);
    expect(ctx).toEqual({ agentId: 'claude-ai-alice', agentName: 'claude-ai-alice', tenantId: 'josh-business', scopes: ['memory:read', 'memory:write'], sourceWeight: 0.8, defaultUserId: 'user-alice', principal: alice });
  });

  it('L-6: delegated scopes are capped at the gateway ceiling (never mcp:delegate; wildcards expand to the explicit list)', () => {
    expect(DELEGATED_SCOPE_CEILING).toEqual([...SHARED_MCP_SCOPES]);
    expect(DELEGATED_SCOPE_CEILING).not.toContain('mcp:delegate');
    expect(agentContextFromPrincipal(carol).scopes).toEqual([...SHARED_MCP_SCOPES]);
    expect(agentContextFromPrincipal({ ...alice, scopes: ['memory:read', 'mcp:delegate', 'files:*', 'admin'] }).scopes).toEqual(['memory:read']);
    expect(agentContextFromPrincipal({ ...alice, scopes: ['memory:*'] }).scopes).toEqual(['memory:read', 'memory:write']);
  });
});

describe('createPrincipalResolver', () => {
  let now: number;
  const clock = () => now;
  const gateway = { introspectToken: vi.fn(), resolveIdentity: vi.fn() };
  beforeEach(() => {
    now = Date.parse('2026-10-18T12:00:00Z');
    gateway.introspectToken.mockReset();
    gateway.resolveIdentity.mockReset();
  });

  it('refuses half-configured resolvers', () => {
    expect(() => createPrincipalResolver({ tokenAuth: false })).toThrow(/no auth mode/);
    expect(() => createPrincipalResolver({ staticApiKey: 'k', tokenAuth: false })).toThrow(/staticAgentCtx/);
    expect(() => createPrincipalResolver({ tokenAuth: true, agentKey: 'g' })).toThrow(/gateway client/);
  });

  it('static key → env principal; no credential → 401 without error=; unknown shapes → invalid_token', async () => {
    const r = createPrincipalResolver({ staticApiKey: 'k', tokenAuth: false }, { staticAgentCtx: staticCtx, now: clock });
    expect(await r.resolve('k')).toEqual({ ok: true, key: STATIC_PRINCIPAL_KEY, agentCtx: staticCtx });
    expect(await r.resolve(undefined)).toEqual({ ok: false, status: 401, reason: 'no credential presented' });
    expect(await r.resolve('nope')).toMatchObject({ ok: false, status: 401, error: 'invalid_token' });
    expect(await r.resolve('omt_x')).toMatchObject({ ok: false, status: 401, error: 'invalid_token', reason: expect.stringMatching(/token auth is not enabled/) });
    expect(await r.resolve('a.b.c')).toMatchObject({ ok: false, status: 401, reason: expect.stringMatching(/oauth is not enabled/) });
  });

  it('omt_ tokens: introspected once per 60 s (positive) / 10 s (negative); 503 on outage is never cached', async () => {
    gateway.introspectToken.mockImplementation(async (token: string) => {
      if (token === OMT_ALICE) return { active: true, principal: alice };
      if (token === OMT_DEAD) return { active: false, reason: 'revoked' };
      throw new Error('ECONNREFUSED');
    });
    const r = createPrincipalResolver({ tokenAuth: true, agentKey: 'g' }, { gateway, now: clock, log: () => {} });

    const a1 = await r.resolve(OMT_ALICE);
    expect(a1).toMatchObject({ ok: true, key: 'token:tok_alice', agentCtx: { agentId: 'claude-ai-alice', defaultUserId: 'user-alice', principal: alice } });
    await r.resolve(OMT_ALICE);
    expect(gateway.introspectToken).toHaveBeenCalledTimes(1);
    expect(gateway.introspectToken).toHaveBeenCalledWith(OMT_ALICE);
    expect(r.isKnownGood(OMT_ALICE)).toBe(true);
    now += PRINCIPAL_CACHE_POSITIVE_MS + 1;
    expect(r.isKnownGood(OMT_ALICE)).toBe(false);
    await r.resolve(OMT_ALICE);
    expect(gateway.introspectToken).toHaveBeenCalledTimes(2);

    expect(await r.resolve(OMT_DEAD)).toEqual({ ok: false, status: 401, error: 'invalid_token', reason: 'revoked' });
    await r.resolve(OMT_DEAD);
    expect(gateway.introspectToken).toHaveBeenCalledTimes(3);
    expect(r.isKnownGood(OMT_DEAD)).toBe(false);
    now += PRINCIPAL_CACHE_NEGATIVE_MS + 1;
    await r.resolve(OMT_DEAD);
    expect(gateway.introspectToken).toHaveBeenCalledTimes(4);

    expect(await r.resolve(OMT_OUTAGE)).toEqual({ ok: false, status: 503, reason: 'token introspection unavailable' });
    await r.resolve(OMT_OUTAGE);
    expect(gateway.introspectToken).toHaveBeenCalledTimes(6);
  });

  it('omt_ tokens: a principal past expiresAt is refused even when the API said active', async () => {
    gateway.introspectToken.mockResolvedValue({ active: true, principal: { ...alice, expiresAt: '2026-10-18T11:00:00Z' } });
    const r = createPrincipalResolver({ tokenAuth: true, agentKey: 'g' }, { gateway, now: clock });
    expect(await r.resolve(OMT_ALICE)).toMatchObject({ ok: false, status: 401, reason: 'expired' });
  });

  it('M-4: malformed omt_ tokens and oversized JWTs are 401 locally — no gateway call, no cache entry', async () => {
    const r = createPrincipalResolver({ tokenAuth: true, agentKey: 'g', publicUrl: PUBLIC_URL, oauth: { issuer: ISSUER, audience: PUBLIC_URL } }, { gateway, jwks: (() => { throw new Error('jwks must not be consulted'); }) as never, now: clock, log: () => {} });
    for (const bad of ['omt_alice', `omt_${'x'.repeat(10_000)}`, `${OMT_ALICE}!`, `${'a'.repeat(JWT_MAX_BYTES)}.b.c`]) {
      const res = await r.resolve(bad);
      expect(res, bad.slice(0, 20)).toMatchObject({ ok: false, status: 401, error: 'invalid_token', reason: expect.stringMatching(/^malformed (token|jwt)$/) });
    }
    expect(gateway.introspectToken).not.toHaveBeenCalled();
    expect(gateway.resolveIdentity).not.toHaveBeenCalled();
    expect(r.cacheSize).toBe(0);
  });

  it('M-4: introspection 4xx → invalid (cached); 401/403 (gateway key problem) and 5xx / network → 503 (never cached)', async () => {
    const lines: string[] = [];
    gateway.introspectToken.mockImplementation(async (token: string) => {
      if (token === omt('too-long')) throw new OmniMindHttpError('POST', '/mcp/tokens/introspect', 400, '{"error":"Validation failed"}');
      if (token === omt('gateway-bad')) throw new OmniMindHttpError('POST', '/mcp/tokens/introspect', 403, '{"error":"insufficient_scope"}');
      if (token === omt('db-down')) throw new OmniMindHttpError('POST', '/mcp/tokens/introspect', 500, 'db down');
      throw new Error('ECONNRESET');
    });
    const r = createPrincipalResolver({ tokenAuth: true, agentKey: 'g' }, { gateway, now: clock, log: l => lines.push(l) });

    expect(await r.resolve(omt('too-long'))).toEqual({ ok: false, status: 401, error: 'invalid_token', reason: 'invalid' });
    await r.resolve(omt('too-long'));
    expect(gateway.introspectToken).toHaveBeenCalledTimes(1); // negative cached

    expect(await r.resolve(omt('gateway-bad'))).toEqual({ ok: false, status: 503, reason: 'token introspection unavailable' });
    expect(lines.some(l => /OMNIMIND_MCP_AGENT_KEY/.test(l))).toBe(true);
    await r.resolve(omt('gateway-bad'));
    expect(gateway.introspectToken).toHaveBeenCalledTimes(3); // not cached

    expect(await r.resolve(omt('db-down'))).toEqual({ ok: false, status: 503, reason: 'token introspection unavailable' });
    expect(await r.resolve(omt('net'))).toEqual({ ok: false, status: 503, reason: 'token introspection unavailable' });
    expect(gateway.introspectToken).toHaveBeenCalledTimes(5);
  });

  it('M-4: a flood of well-formed unknown tokens fills the negative cache but never evicts a positive', async () => {
    gateway.introspectToken.mockImplementation(async (token: string) =>
      token === OMT_ALICE ? { active: true, principal: alice } : { active: false, reason: 'invalid' });
    const r = createPrincipalResolver({ tokenAuth: true, agentKey: 'g' }, { gateway, now: clock, log: () => {} });
    await r.resolve(OMT_ALICE);
    expect(r.positiveCacheSize).toBe(1);
    for (let i = 0; i < PRINCIPAL_CACHE_MAX_ENTRIES + 50; i++) await r.resolve(omt(`nonce-${i}`));
    expect(r.cacheSize).toBe(PRINCIPAL_CACHE_MAX_ENTRIES + 1); // 2,000 negatives (LRU-capped) + the positive
    expect(r.positiveCacheSize).toBe(1);
    const calls = gateway.introspectToken.mock.calls.length;
    await r.resolve(OMT_ALICE);
    expect(gateway.introspectToken.mock.calls.length).toBe(calls); // still served from the positive cache
  });

  describe('OAuth access tokens (JWT verified with an in-test JWKS)', () => {
    let privateKey: CryptoKey;
    let otherKey: CryptoKey;
    let jwk: JWK;
    const cfg = (): PrincipalAuthConfig => ({ tokenAuth: false, agentKey: 'g', publicUrl: PUBLIC_URL, oauth: { issuer: ISSUER, audience: PUBLIC_URL } });

    async function mint(opts: { aud?: string; iss?: string; exp?: number; key?: CryptoKey; scope?: string; sub?: string; extra?: Record<string, unknown> } = {}) {
      const nowS = Math.floor(now / 1000);
      let jwt = new SignJWT({ email: 'carol@example.test', email_verified: true, azp: 'chatgpt-client', ...(opts.scope !== undefined ? { scope: opts.scope } : {}), ...opts.extra })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(opts.iss ?? ISSUER)
        .setAudience(opts.aud ?? PUBLIC_URL)
        .setSubject(opts.sub ?? 'sub-carol')
        .setIssuedAt(nowS)
        .setExpirationTime(opts.exp ?? nowS + 300);
      return jwt.sign(opts.key ?? privateKey);
    }

    beforeEach(async () => {
      const pair = await generateKeyPair('RS256');
      privateKey = pair.privateKey;
      jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
      ({ privateKey: otherKey } = await generateKeyPair('RS256'));
      gateway.resolveIdentity.mockImplementation(async (claims: { subject: string }) =>
        claims.subject === 'sub-carol' ? { active: true, principal: carol } : { active: false, reason: 'unlinked' });
    });

    const jwks = () => createLocalJWKSet({ keys: [jwk] });

    it('valid token → identity resolved with the forwarded claims; cached per token', async () => {
      // Use fake timers so jose's own exp check agrees with the injected clock.
      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        const r = createPrincipalResolver(cfg(), { gateway, jwks: jwks(), now: clock, log: () => {} });
        const token = await mint();
        const res = await r.resolve(token);
        expect(res).toMatchObject({ ok: true, key: 'oauth:oid_carol', agentCtx: { agentId: 'chatgpt-carol', defaultUserId: 'user-carol', scopes: [...SHARED_MCP_SCOPES] } }); // '*' capped at the ceiling (L-6)
        expect(gateway.resolveIdentity).toHaveBeenCalledWith({ issuer: ISSUER, subject: 'sub-carol', email: 'carol@example.test', emailVerified: true, clientId: 'chatgpt-client' });
        await r.resolve(token);
        expect(gateway.resolveIdentity).toHaveBeenCalledTimes(1);
        // The cached lifetime is capped at the token's exp (5 min here → 60 s cap applies).
        if (!res.ok) throw new Error('unreachable');
        expect(res.agentCtx.principal?.expiresAt).toBe(new Date((Math.floor(now / 1000) + 300) * 1000).toISOString());
      } finally {
        vi.useRealTimers();
      }
    });

    it('scope claim narrows the principal; unlinked subject → 401', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        const r = createPrincipalResolver(cfg(), { gateway, jwks: jwks(), now: clock, log: () => {} });
        const narrowed = await r.resolve(await mint({ scope: 'memory:read task:write' }));
        expect(narrowed).toMatchObject({ ok: true, agentCtx: { scopes: ['memory:read', 'task:write'] } });
        const unlinked = await r.resolve(await mint({ sub: 'sub-nobody' }));
        expect(unlinked).toEqual({ ok: false, status: 401, error: 'invalid_token', reason: 'unlinked' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('L-2: an OIDC-only scope claim keeps the identity\'s stored scopes (logged once); mixed claims drop the OIDC part', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        const lines: string[] = [];
        const r = createPrincipalResolver(cfg(), { gateway, jwks: jwks(), now: clock, log: l => lines.push(l) });
        const oidcOnly = await r.resolve(await mint({ scope: 'openid email profile' }));
        expect(oidcOnly).toMatchObject({ ok: true, agentCtx: { scopes: [...SHARED_MCP_SCOPES] } });
        await r.resolve(await mint({ scope: 'openid offline_access', extra: { jti: '2' } }));
        expect(lines.filter(l => /no MCP scopes/.test(l))).toHaveLength(1);
        const mixed = await r.resolve(await mint({ scope: 'openid memory:read profile', extra: { jti: '3' } }));
        expect(mixed).toMatchObject({ ok: true, agentCtx: { scopes: ['memory:read'] } });
        const empty = await r.resolve(await mint({ scope: '', extra: { jti: '4' } }));
        expect(empty).toMatchObject({ ok: true, agentCtx: { scopes: [...SHARED_MCP_SCOPES] } }); // empty claim == absent
      } finally {
        vi.useRealTimers();
      }
    });

    it('issuer_not_allowed from identity resolution is a 401 invalid_token like unlinked (gateway consulted once)', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        gateway.resolveIdentity.mockResolvedValue({ active: false, reason: 'issuer_not_allowed' });
        const r = createPrincipalResolver(cfg(), { gateway, jwks: jwks(), now: clock, log: () => {} });
        const token = await mint();
        expect(await r.resolve(token)).toEqual({ ok: false, status: 401, error: 'invalid_token', reason: 'issuer_not_allowed' });
        await r.resolve(token);
        expect(gateway.resolveIdentity).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('M-4: identity-resolution 4xx → 401 invalid (cached); 403 → 503', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        gateway.resolveIdentity.mockRejectedValueOnce(new OmniMindHttpError('POST', '/mcp/identities/resolve', 400, 'bad subject'));
        const r = createPrincipalResolver(cfg(), { gateway, jwks: jwks(), now: clock, log: () => {} });
        const token = await mint();
        expect(await r.resolve(token)).toEqual({ ok: false, status: 401, error: 'invalid_token', reason: 'invalid' });
        await r.resolve(token);
        expect(gateway.resolveIdentity).toHaveBeenCalledTimes(1);
        gateway.resolveIdentity.mockRejectedValueOnce(new OmniMindHttpError('POST', '/mcp/identities/resolve', 403, 'gateway lacks mcp:delegate'));
        expect(await r.resolve(await mint({ extra: { jti: 'x' } }))).toEqual({ ok: false, status: 503, reason: 'identity resolution unavailable' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('audience mismatch, wrong issuer, wrong key and expiry → 401 invalid_token; gateway never consulted', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        const r = createPrincipalResolver(cfg(), { gateway, jwks: jwks(), now: clock, log: () => {} });
        expect(await r.resolve(await mint({ aud: 'https://other.example.test/mcp' }))).toMatchObject({ ok: false, status: 401, error: 'invalid_token' });
        expect(await r.resolve(await mint({ iss: 'https://evil.example.test' }))).toMatchObject({ ok: false, status: 401, error: 'invalid_token' });
        expect(await r.resolve(await mint({ key: otherKey }))).toMatchObject({ ok: false, status: 401, error: 'invalid_token' });
        expect(await r.resolve(await mint({ exp: Math.floor(now / 1000) - 120 }))).toEqual({ ok: false, status: 401, error: 'invalid_token', reason: 'expired' });
        expect(gateway.resolveIdentity).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('identity resolution outage → 503, not cached', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        gateway.resolveIdentity.mockRejectedValue(new Error('502'));
        const r = createPrincipalResolver(cfg(), { gateway, jwks: jwks(), now: clock, log: () => {} });
        const token = await mint();
        expect(await r.resolve(token)).toEqual({ ok: false, status: 503, reason: 'identity resolution unavailable' });
        await r.resolve(token);
        expect(gateway.resolveIdentity).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
