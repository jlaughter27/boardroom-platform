// Zod schemas for MCP per-user tokens + OAuth identities — Lane A1 (2026-10-18).
// Structurally match `types/mcp-token.types.ts` (wire shapes, ISO strings).

import { z } from 'zod';
import {
  MCP_IDENTITY_LIST_DEFAULT_LIMIT,
  MCP_IDENTITY_LIST_MAX_LIMIT,
  MCP_SCOPES,
  MCP_SOURCE_WEIGHT_MAX,
  MCP_SOURCE_WEIGHT_MIN,
  MCP_TOKEN_EXPIRES_IN_DAYS_MAX,
  MCP_TOKEN_EXPIRES_IN_DAYS_MIN,
  MCP_TOKEN_NAME_MAX_LENGTH,
  MCP_TOKEN_NAME_MIN_LENGTH,
} from '../types/mcp-token.types';

// ── Scopes ──

export const McpScopeSchema = z.enum(MCP_SCOPES);

/** Non-empty, de-duplicated subset of MCP_SCOPES (wildcards and `mcp:delegate` are rejected by the enum). */
export const McpScopesSchema = z
  .array(McpScopeSchema)
  .min(1, 'at least one scope is required')
  .max(MCP_SCOPES.length)
  .refine(list => new Set(list).size === list.length, { message: 'scopes must not repeat' });

export const McpScopeDescriptorSchema = z.object({
  id: McpScopeSchema,
  description: z.string(),
  write: z.boolean(),
});

export const McpSourceWeightSchema = z.number().min(MCP_SOURCE_WEIGHT_MIN).max(MCP_SOURCE_WEIGHT_MAX);

export const McpPrincipalKindSchema = z.enum(['token', 'oauth']);

/** `token:<id>` | `oauth:<id>` — the `x-mcp-principal` header value. */
export const McpPrincipalRefSchema = z
  .string()
  .regex(/^(token|oauth):[A-Za-z0-9_-]{1,64}$/, 'x-mcp-principal must be token:<id> or oauth:<id>');

// ── Records ──

export const McpTokenRecordSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string().min(MCP_TOKEN_NAME_MIN_LENGTH).max(MCP_TOKEN_NAME_MAX_LENGTH),
  agentName: z.string().min(1),
  prefix: z.string().min(1),
  scopes: z.array(McpScopeSchema),
  sourceWeight: McpSourceWeightSchema,
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});

export const McpPrincipalSchema = z.object({
  kind: McpPrincipalKindSchema,
  id: z.string().min(1),
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  agentName: z.string().min(1),
  scopes: z.array(McpScopeSchema),
  sourceWeight: McpSourceWeightSchema,
  name: z.string().optional(),
  expiresAt: z.string().optional(),
});

// ── Requests / responses ──

export const McpTokenCreateRequestSchema = z.object({
  userId: z.string().trim().min(1),
  tenantId: z.string().trim().min(1),
  name: z.string().trim().min(MCP_TOKEN_NAME_MIN_LENGTH).max(MCP_TOKEN_NAME_MAX_LENGTH),
  scopes: McpScopesSchema,
  sourceWeight: McpSourceWeightSchema.optional(),
  // omitted → default (365 days); null → never expires (explicit)
  expiresInDays: z.number().int().min(MCP_TOKEN_EXPIRES_IN_DAYS_MIN).max(MCP_TOKEN_EXPIRES_IN_DAYS_MAX).nullable().optional(),
});

export const McpTokenCreateResponseSchema = z.object({
  token: z.string().min(1),
  record: McpTokenRecordSchema,
});

export const McpTokenListQuerySchema = z.object({
  userId: z.string().trim().min(1),
});

export const McpTokenListResponseSchema = z.object({
  tokens: z.array(McpTokenRecordSchema),
});

export const McpTokenOptionsTenantSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
});

export const McpTokenOptionsSchema = z.object({
  tenants: z.array(McpTokenOptionsTenantSchema),
  scopes: z.array(McpScopeDescriptorSchema),
});

export const McpTokenIntrospectRequestSchema = z.object({
  token: z.string().trim().min(1).max(256),
});

export const McpTokenInactiveReasonSchema = z.enum(['invalid', 'expired', 'revoked']);

export const McpPrincipalActiveSchema = z.object({
  active: z.literal(true),
  principal: McpPrincipalSchema,
});

export const McpTokenIntrospectInactiveSchema = z.object({
  active: z.literal(false),
  reason: McpTokenInactiveReasonSchema,
});

export const McpTokenIntrospectResponseSchema = z.discriminatedUnion('active', [
  McpPrincipalActiveSchema,
  McpTokenIntrospectInactiveSchema,
]);

export const McpIdentityResolveRequestSchema = z.object({
  issuer: z.string().trim().min(1).max(512),
  subject: z.string().trim().min(1).max(512),
  email: z.string().trim().email().optional(),
  emailVerified: z.boolean().optional(),
  clientId: z.string().trim().min(1).max(256).optional(),
});

export const McpIdentityInactiveReasonSchema = z.enum(['unlinked', 'issuer_not_allowed']);

export const McpIdentityResolveInactiveSchema = z.object({
  active: z.literal(false),
  reason: McpIdentityInactiveReasonSchema,
});

export const McpIdentityResolveResponseSchema = z.discriminatedUnion('active', [
  McpPrincipalActiveSchema,
  McpIdentityResolveInactiveSchema,
]);

// ── OAuth identity administration ──

export const McpOauthIdentityRecordSchema = z.object({
  id: z.string().min(1),
  issuer: z.string().min(1),
  subject: z.string().min(1),
  userId: z.string().min(1),
  tenantId: z.string().min(1),
  agentName: z.string().min(1),
  scopes: z.array(McpScopeSchema),
  sourceWeight: McpSourceWeightSchema,
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});

// userId omitted → all identities (admin view); limit is a query string → coerced
export const McpIdentityListQuerySchema = z.object({
  userId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MCP_IDENTITY_LIST_MAX_LIMIT).default(MCP_IDENTITY_LIST_DEFAULT_LIMIT),
});

export const McpIdentityListResponseSchema = z.object({
  identities: z.array(McpOauthIdentityRecordSchema),
});

// scopes omitted → MCP_OAUTH_DEFAULT_SCOPES (applied server-side, not here, so the
// schema stays a structural mirror of McpIdentityCreateRequest)
export const McpIdentityCreateRequestSchema = z.object({
  issuer: z.string().trim().min(1).max(512),
  subject: z.string().trim().min(1).max(512),
  userId: z.string().trim().min(1),
  tenantId: z.string().trim().min(1),
  scopes: McpScopesSchema.optional(),
  sourceWeight: McpSourceWeightSchema.optional(),
  clientId: z.string().trim().min(1).max(256).optional(),
});

export const McpIdentityCreateResponseSchema = z.object({
  identity: McpOauthIdentityRecordSchema,
});

export const McpIdentityUpdateRequestSchema = z
  .object({
    tenantId: z.string().trim().min(1).optional(),
    scopes: McpScopesSchema.optional(),
  })
  .refine(v => v.tenantId !== undefined || v.scopes !== undefined, { message: 'tenantId or scopes is required' });

export const McpAuditStatsQuerySchema = z.object({
  tool: z.string().trim().min(1).max(100).optional(),
  sinceHours: z.coerce.number().int().min(1).max(24 * 90).default(24),
  tenantId: z.string().trim().min(1).optional(),
});

export const McpAuditStatsSchema = z.object({
  tool: z.string().nullable(),
  sinceHours: z.number().int().positive(),
  count: z.number().int().nonnegative(),
  p50Ms: z.number().nonnegative(),
  p95Ms: z.number().nonnegative(),
  errorRate: z.number().min(0).max(1),
});

export const AdminTenantOwnerUpdateRequestSchema = z.object({
  ownerUserId: z.string().trim().min(1),
});

export const AdminTenantRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  ownerUserId: z.string().nullable(),
});

// ── Inferred types (for callers that prefer z.infer; the interfaces in
//    types/mcp-token.types.ts are the canonical shapes) ──

export type McpTokenCreateRequestInput = z.input<typeof McpTokenCreateRequestSchema>;
export type McpIdentityResolveRequestInput = z.input<typeof McpIdentityResolveRequestSchema>;
export type McpIdentityCreateRequestInput = z.input<typeof McpIdentityCreateRequestSchema>;
export type McpIdentityListQueryInput = z.input<typeof McpIdentityListQuerySchema>;
export type McpIdentityUpdateRequestInput = z.input<typeof McpIdentityUpdateRequestSchema>;
export type McpAuditStatsQueryInput = z.input<typeof McpAuditStatsQuerySchema>;
