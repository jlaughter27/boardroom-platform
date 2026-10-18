/**
 * Front door — principal resolution unit tests: env config, RFC 6750 / 9728
 * builders, scope intersection, and `createPrincipalResolver` for the three
 * credential types with a mocked gateway client and an in-test JWKS.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK, type CryptoKey } from 'jose';
import {
  resolvePrincipalAuthConfig, buildWwwAuthenticate, buildProtectedResourceMetadata, isProtectedResourceMetadataPath,
  intersectScopes, looksLikeJwt, credentialDigest, parsePrincipal, agentContextFromPrincipal, createPrincipalResolver,
  MCP_SCOPES, STATIC_PRINCIPAL_KEY, PRM_PATH, DEFAULT_DOCS_URL, PRINCIPAL_CACHE_POSITIVE_MS, PRINCIPAL_CACHE_NEGATIVE_MS,
  type PrincipalAuthConfig,
} from '../src/lib/principal';
import type { AgentContext } from '../src/types';

const PUBLIC_URL = 'https://mcp.example.test/mcp';
const ISSUER = 'https://auth.example.test';

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

  it('parsePrincipal validates the wire shape and the source weight range', () => {
    expect(parsePrincipal(alice)).toEqual(alice);
    expect(() => parsePrincipal({ ...alice, sourceWeight: 9 })).toThrow(/between 0 and 2/);
    expect(() => parsePrincipal({ ...alice, kind: 'static' })).toThrow();
    expect(() => parsePrincipal({ ...alice, userId: '' })).toThrow();
    const ctx = agentContextFromPrincipal(alice);
    expect(ctx).toEqual({ agentId: 'claude-ai-alice', agentName: 'claude-ai-alice', tenantId: 'josh-business', scopes: ['memory:read', 'memory:write'], sourceWeight: 0.8, defaultUserId: 'user-alice', principal: alice });
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
      if (token === 'omt_alice') return { active: true, principal: alice };
      if (token === 'omt_dead') return { active: false, reason: 'revoked' };
      throw new Error('ECONNREFUSED');
    });
    const r = createPrincipalResolver({ tokenAuth: true, agentKey: 'g' }, { gateway, now: clock, log: () => {} });

    const a1 = await r.resolve('omt_alice');
    expect(a1).toMatchObject({ ok: true, key: 'token:tok_alice', agentCtx: { agentId: 'claude-ai-alice', defaultUserId: 'user-alice', principal: alice } });
    await r.resolve('omt_alice');
    expect(gateway.introspectToken).toHaveBeenCalledTimes(1);
    expect(gateway.introspectToken).toHaveBeenCalledWith('omt_alice');
    now += PRINCIPAL_CACHE_POSITIVE_MS + 1;
    await r.resolve('omt_alice');
    expect(gateway.introspectToken).toHaveBeenCalledTimes(2);

    expect(await r.resolve('omt_dead')).toEqual({ ok: false, status: 401, error: 'invalid_token', reason: 'revoked' });
    await r.resolve('omt_dead');
    expect(gateway.introspectToken).toHaveBeenCalledTimes(3);
    now += PRINCIPAL_CACHE_NEGATIVE_MS + 1;
    await r.resolve('omt_dead');
    expect(gateway.introspectToken).toHaveBeenCalledTimes(4);

    expect(await r.resolve('omt_outage')).toEqual({ ok: false, status: 503, reason: 'token introspection unavailable' });
    await r.resolve('omt_outage');
    expect(gateway.introspectToken).toHaveBeenCalledTimes(6);
  });

  it('omt_ tokens: a principal past expiresAt is refused even when the API said active', async () => {
    gateway.introspectToken.mockResolvedValue({ active: true, principal: { ...alice, expiresAt: '2026-10-18T11:00:00Z' } });
    const r = createPrincipalResolver({ tokenAuth: true, agentKey: 'g' }, { gateway, now: clock });
    expect(await r.resolve('omt_alice')).toMatchObject({ ok: false, status: 401, reason: 'expired' });
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
        expect(res).toMatchObject({ ok: true, key: 'oauth:oid_carol', agentCtx: { agentId: 'chatgpt-carol', defaultUserId: 'user-carol', scopes: ['*'] } });
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
