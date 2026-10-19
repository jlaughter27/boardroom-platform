/**
 * Lane A1 — mcp-token types ↔ Zod schemas stay structurally aligned, and the
 * scope vocabulary is closed (no wildcards, no mcp:delegate on tokens).
 */
import { describe, it, expect } from 'vitest';
import {
  MCP_DELEGATE_SCOPE,
  MCP_GATEWAY_CEILING_SCOPES,
  MCP_GATEWAY_SCOPES,
  MCP_IDENTITY_LIST_DEFAULT_LIMIT,
  MCP_IDENTITY_LIST_MAX_LIMIT,
  MCP_OAUTH_DEFAULT_SCOPES,
  MCP_PRINCIPAL_HEADER,
  MCP_SCOPE_DESCRIPTORS,
  MCP_SCOPES,
  MCP_TOKEN_DEFAULT_EXPIRES_IN_DAYS,
  MCP_TOKEN_MAX_ACTIVE_PER_USER,
  MCP_TOKEN_PREFIX,
  McpAuditStatsQuerySchema,
  McpAuditStatsSchema,
  McpIdentityCreateRequestSchema,
  McpIdentityCreateResponseSchema,
  McpIdentityListQuerySchema,
  McpIdentityResolveRequestSchema,
  McpIdentityResolveResponseSchema,
  McpIdentityUpdateRequestSchema,
  McpOauthIdentityRecordSchema,
  McpPrincipalRefSchema,
  McpPrincipalSchema,
  McpScopeSchema,
  McpTokenCreateRequestSchema,
  McpTokenIntrospectResponseSchema,
  McpTokenRecordSchema,
  type McpAuditStats,
  type McpIdentityCreateRequest,
  type McpIdentityListQuery,
  type McpIdentityResolveResponse,
  type McpIdentityUpdateRequest,
  type McpOauthIdentityRecord,
  type McpPrincipal,
  type McpTokenCreateRequest,
  type McpTokenIntrospectResponse,
  type McpTokenRecord,
} from '../index';

describe('MCP scope vocabulary', () => {
  it('is the canonical seven grantable scopes + the gateway-only delegate scope', () => {
    expect([...MCP_SCOPES]).toEqual(['memory:read', 'memory:write', 'decision:write', 'task:write', 'commitment:write', 'project:write', 'code:write']);
    expect(MCP_DELEGATE_SCOPE).toBe('mcp:delegate');
    expect([...MCP_GATEWAY_SCOPES]).toEqual(['mcp:delegate']);
    expect(MCP_SCOPES as readonly string[]).not.toContain('mcp:delegate');
    expect(MCP_SCOPE_DESCRIPTORS.map(d => d.id)).toEqual([...MCP_SCOPES]);
    expect(MCP_SCOPE_DESCRIPTORS.filter(d => !d.write).map(d => d.id)).toEqual(['memory:read']);
    expect([...MCP_OAUTH_DEFAULT_SCOPES]).toEqual(['memory:read']);
    expect(MCP_TOKEN_PREFIX).toBe('omt_');
    expect(MCP_TOKEN_MAX_ACTIVE_PER_USER).toBe(25);
    expect(MCP_PRINCIPAL_HEADER).toBe('x-mcp-principal');
  });

  it('MCP_GATEWAY_CEILING_SCOPES is one list: every grantable scope (incl. code:write) + mcp:delegate, nothing else', () => {
    expect([...MCP_GATEWAY_CEILING_SCOPES]).toEqual([...MCP_SCOPES, MCP_DELEGATE_SCOPE]);
    expect(MCP_GATEWAY_CEILING_SCOPES as readonly string[]).toContain('code:write');
    expect(MCP_GATEWAY_CEILING_SCOPES as readonly string[]).not.toContain('*');
    // every ceiling scope except the delegate scope is grantable to a token
    for (const s of MCP_GATEWAY_CEILING_SCOPES) {
      expect(McpScopeSchema.safeParse(s).success).toBe(s !== MCP_DELEGATE_SCOPE);
    }
  });

  it('McpScopeSchema rejects wildcards and the delegate scope', () => {
    for (const s of MCP_SCOPES) expect(McpScopeSchema.safeParse(s).success).toBe(true);
    for (const bad of ['*', 'memory:*', 'mcp:delegate', 'admin', '']) expect(McpScopeSchema.safeParse(bad).success).toBe(false);
  });
});

describe('McpTokenCreateRequestSchema', () => {
  const ok: McpTokenCreateRequest = { userId: 'u', tenantId: 't', name: 'Claude Desktop', scopes: ['memory:read'] };

  it('accepts a minimal + a full request', () => {
    expect(McpTokenCreateRequestSchema.safeParse(ok).success).toBe(true);
    expect(McpTokenCreateRequestSchema.safeParse({ ...ok, sourceWeight: 2, expiresInDays: 365, scopes: [...MCP_SCOPES] }).success).toBe(true);
  });

  it('expiresInDays: omitted (→ server default 365) and explicit null (never) are both accepted', () => {
    expect(MCP_TOKEN_DEFAULT_EXPIRES_IN_DAYS).toBe(365);
    const omitted = McpTokenCreateRequestSchema.safeParse(ok);
    expect(omitted.success).toBe(true);
    if (omitted.success) expect(omitted.data.expiresInDays).toBeUndefined();
    const never = McpTokenCreateRequestSchema.safeParse({ ...ok, expiresInDays: null });
    expect(never.success).toBe(true);
    if (never.success) expect(never.data.expiresInDays).toBeNull();
    const typed: McpTokenCreateRequest = { ...ok, expiresInDays: null };
    expect(McpTokenCreateRequestSchema.safeParse(typed).success).toBe(true);
  });

  it('rejects empty/duplicate scopes, long names, out-of-range weight/expiry', () => {
    expect(McpTokenCreateRequestSchema.safeParse({ ...ok, scopes: [] }).success).toBe(false);
    expect(McpTokenCreateRequestSchema.safeParse({ ...ok, scopes: ['memory:read', 'memory:read'] }).success).toBe(false);
    expect(McpTokenCreateRequestSchema.safeParse({ ...ok, scopes: ['mcp:delegate'] }).success).toBe(false);
    expect(McpTokenCreateRequestSchema.safeParse({ ...ok, name: '' }).success).toBe(false);
    expect(McpTokenCreateRequestSchema.safeParse({ ...ok, name: 'x'.repeat(61) }).success).toBe(false);
    expect(McpTokenCreateRequestSchema.safeParse({ ...ok, sourceWeight: -0.1 }).success).toBe(false);
    expect(McpTokenCreateRequestSchema.safeParse({ ...ok, sourceWeight: 2.01 }).success).toBe(false);
    expect(McpTokenCreateRequestSchema.safeParse({ ...ok, expiresInDays: 0 }).success).toBe(false);
    expect(McpTokenCreateRequestSchema.safeParse({ ...ok, expiresInDays: 366 }).success).toBe(false);
    expect(McpTokenCreateRequestSchema.safeParse({ ...ok, expiresInDays: 1.5 }).success).toBe(false);
  });
});

describe('record / principal / response schemas match the interfaces', () => {
  const record: McpTokenRecord = {
    id: 'ctoken0000000000000000001', userId: 'u', tenantId: 't', name: 'n', agentName: 'mcp-token:n-000001', prefix: 'omt_abcdefgh',
    scopes: ['memory:read'], sourceWeight: 1, createdAt: '2026-10-18T00:00:00.000Z', lastUsedAt: null, expiresAt: null, revokedAt: null,
  };
  const principal: McpPrincipal = { kind: 'token', id: 'ctoken0000000000000000001', userId: 'u', tenantId: 't', agentName: 'mcp-token:n-000001', scopes: ['memory:read'], sourceWeight: 1, name: 'n', expiresAt: '2026-11-18T00:00:00.000Z' };

  it('McpTokenRecordSchema accepts the interface shape and rejects a leaked hash-free-but-wrong record', () => {
    expect(McpTokenRecordSchema.parse(record)).toEqual(record);
    expect(McpTokenRecordSchema.safeParse({ ...record, scopes: ['*'] }).success).toBe(false);
    expect(McpTokenRecordSchema.safeParse({ ...record, lastUsedAt: undefined }).success).toBe(false);
  });

  it('McpPrincipalSchema accepts token + oauth principals', () => {
    expect(McpPrincipalSchema.parse(principal)).toEqual(principal);
    const oauth: McpPrincipal = { kind: 'oauth', id: 'cident0000000000000000001', userId: 'u', tenantId: 't', agentName: 'oauth:acc.example.com', scopes: ['memory:read'], sourceWeight: 1 };
    expect(McpPrincipalSchema.parse(oauth)).toEqual(oauth);
    expect(McpPrincipalSchema.safeParse({ ...oauth, kind: 'agent' }).success).toBe(false);
  });

  it('introspect / resolve discriminated unions', () => {
    const active: McpTokenIntrospectResponse = { active: true, principal };
    const inactive: McpTokenIntrospectResponse = { active: false, reason: 'expired' };
    expect(McpTokenIntrospectResponseSchema.parse(active)).toEqual(active);
    expect(McpTokenIntrospectResponseSchema.parse(inactive)).toEqual(inactive);
    expect(McpTokenIntrospectResponseSchema.safeParse({ active: false, reason: 'unlinked' }).success).toBe(false);

    const unlinked: McpIdentityResolveResponse = { active: false, reason: 'unlinked' };
    expect(McpIdentityResolveResponseSchema.parse(unlinked)).toEqual(unlinked);
    expect(McpIdentityResolveResponseSchema.safeParse({ active: false, reason: 'expired' }).success).toBe(false);
  });

  it('resolve inactive reason is unlinked | issuer_not_allowed', () => {
    const notAllowed: McpIdentityResolveResponse = { active: false, reason: 'issuer_not_allowed' };
    expect(McpIdentityResolveResponseSchema.safeParse(notAllowed).success).toBe(true);
    expect(McpIdentityResolveResponseSchema.safeParse({ active: false, reason: 'nope' }).success).toBe(false);
  });

  it('McpOauthIdentityRecordSchema matches the interface; McpIdentityUpdateRequestSchema needs tenantId or scopes', () => {
    const rec: McpOauthIdentityRecord = {
      id: 'cident1', issuer: 'https://idp.example', subject: 'sub', userId: 'u', tenantId: 't', agentName: 'oauth:claude-desktop-abcdefgh',
      scopes: ['memory:read'], sourceWeight: 1, createdAt: '2026-10-18T00:00:00.000Z', lastUsedAt: null, revokedAt: null,
    };
    expect(McpOauthIdentityRecordSchema.safeParse(rec).success).toBe(true);
    expect(McpOauthIdentityRecordSchema.safeParse({ ...rec, scopes: ['mcp:delegate'] }).success).toBe(false);

    const both: McpIdentityUpdateRequest = { tenantId: 't2', scopes: ['memory:read', 'task:write'] };
    expect(McpIdentityUpdateRequestSchema.safeParse(both).success).toBe(true);
    expect(McpIdentityUpdateRequestSchema.safeParse({ tenantId: 't2' }).success).toBe(true);
    expect(McpIdentityUpdateRequestSchema.safeParse({ scopes: ['memory:read'] }).success).toBe(true);
    expect(McpIdentityUpdateRequestSchema.safeParse({}).success).toBe(false);
    expect(McpIdentityUpdateRequestSchema.safeParse({ scopes: [] }).success).toBe(false);
    expect(McpIdentityUpdateRequestSchema.safeParse({ scopes: ['*'] }).success).toBe(false);
    expect(McpIdentityUpdateRequestSchema.safeParse({ scopes: ['mcp:delegate'] }).success).toBe(false);
  });

  it('McpIdentityCreateRequestSchema matches the interface: scopes optional (server default), subset-only; clientId/sourceWeight bounded', () => {
    const minimal: McpIdentityCreateRequest = { issuer: 'https://idp.example', subject: 'sub-1', userId: 'u', tenantId: 't' };
    const full: McpIdentityCreateRequest = { ...minimal, scopes: ['memory:read', 'task:write'], sourceWeight: 1.5, clientId: 'chatgpt' };
    expect(McpIdentityCreateRequestSchema.safeParse(minimal).success).toBe(true);
    expect(McpIdentityCreateRequestSchema.safeParse(full).success).toBe(true);
    // scopes stay optional in the schema: the default is applied by the API so the shape mirrors the interface
    expect(McpIdentityCreateRequestSchema.parse(minimal).scopes).toBeUndefined();
    for (const bad of [
      { ...minimal, issuer: '' }, { ...minimal, subject: '' }, { ...minimal, userId: '' }, { ...minimal, tenantId: '' },
      { ...minimal, scopes: [] }, { ...minimal, scopes: ['*'] }, { ...minimal, scopes: ['mcp:delegate'] }, { ...minimal, scopes: ['memory:read', 'memory:read'] },
      { ...minimal, sourceWeight: 2.5 }, { ...minimal, clientId: '' }, { ...minimal, issuer: 'x'.repeat(513) },
    ]) expect(McpIdentityCreateRequestSchema.safeParse(bad).success).toBe(false);
    const rec: McpOauthIdentityRecord = {
      id: 'cident1', issuer: 'https://idp.example', subject: 'sub-1', userId: 'u', tenantId: 't', agentName: 'oauth:chatgpt-abcdefgh',
      scopes: ['memory:read'], sourceWeight: 1, createdAt: '2026-10-19T00:00:00.000Z', lastUsedAt: null, revokedAt: null,
    };
    expect(McpIdentityCreateResponseSchema.safeParse({ identity: rec }).success).toBe(true);
    expect(McpIdentityCreateResponseSchema.safeParse({}).success).toBe(false);
  });

  it('McpIdentityListQuerySchema: userId optional (admin list-all), limit coerced with default 50 and ceiling 200', () => {
    const none: McpIdentityListQuery = {};
    expect(McpIdentityListQuerySchema.parse(none)).toEqual({ limit: MCP_IDENTITY_LIST_DEFAULT_LIMIT });
    expect(McpIdentityListQuerySchema.parse({ userId: 'u', limit: '25' })).toEqual({ userId: 'u', limit: 25 });
    expect(McpIdentityListQuerySchema.parse({ limit: String(MCP_IDENTITY_LIST_MAX_LIMIT) }).limit).toBe(MCP_IDENTITY_LIST_MAX_LIMIT);
    for (const bad of [{ limit: '0' }, { limit: '201' }, { limit: '1.5' }, { limit: 'abc' }, { userId: '' }]) {
      expect(McpIdentityListQuerySchema.safeParse(bad).success).toBe(false);
    }
  });

  it('McpIdentityResolveRequestSchema requires issuer + subject, validates email', () => {
    expect(McpIdentityResolveRequestSchema.safeParse({ issuer: 'https://a.example', subject: 's' }).success).toBe(true);
    expect(McpIdentityResolveRequestSchema.safeParse({ issuer: 'https://a.example', subject: 's', email: 'not-an-email', emailVerified: true }).success).toBe(false);
    expect(McpIdentityResolveRequestSchema.safeParse({ issuer: '', subject: 's' }).success).toBe(false);
  });

  it('McpPrincipalRefSchema matches token:<id> / oauth:<id> only', () => {
    expect(McpPrincipalRefSchema.safeParse('token:ctoken0000000000000000001').success).toBe(true);
    expect(McpPrincipalRefSchema.safeParse('oauth:abc_DEF-123').success).toBe(true);
    for (const bad of ['agent:x', 'token:', 'token:has space', 'oauth:' + 'x'.repeat(65)]) expect(McpPrincipalRefSchema.safeParse(bad).success).toBe(false);
  });

  it('audit stats query coerces + defaults; stats shape', () => {
    expect(McpAuditStatsQuerySchema.parse({})).toEqual({ sinceHours: 24 });
    expect(McpAuditStatsQuerySchema.parse({ tool: 'memory_search', sinceHours: '48' })).toEqual({ tool: 'memory_search', sinceHours: 48 });
    expect(McpAuditStatsQuerySchema.safeParse({ sinceHours: '0' }).success).toBe(false);
    const stats: McpAuditStats = { tool: null, sinceHours: 24, count: 0, p50Ms: 0, p95Ms: 0, errorRate: 0 };
    expect(McpAuditStatsSchema.parse(stats)).toEqual(stats);
    expect(McpAuditStatsSchema.safeParse({ ...stats, errorRate: 1.5 }).success).toBe(false);
  });
});
