/**
 * Lane A1 — mcp-token types ↔ Zod schemas stay structurally aligned, and the
 * scope vocabulary is closed (no wildcards, no mcp:delegate on tokens).
 */
import { describe, it, expect } from 'vitest';
import {
  MCP_DELEGATE_SCOPE,
  MCP_GATEWAY_SCOPES,
  MCP_OAUTH_DEFAULT_SCOPES,
  MCP_PRINCIPAL_HEADER,
  MCP_SCOPE_DESCRIPTORS,
  MCP_SCOPES,
  MCP_TOKEN_MAX_ACTIVE_PER_USER,
  MCP_TOKEN_PREFIX,
  McpAuditStatsQuerySchema,
  McpAuditStatsSchema,
  McpIdentityResolveRequestSchema,
  McpIdentityResolveResponseSchema,
  McpPrincipalRefSchema,
  McpPrincipalSchema,
  McpScopeSchema,
  McpTokenCreateRequestSchema,
  McpTokenIntrospectResponseSchema,
  McpTokenRecordSchema,
  type McpAuditStats,
  type McpIdentityResolveResponse,
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
