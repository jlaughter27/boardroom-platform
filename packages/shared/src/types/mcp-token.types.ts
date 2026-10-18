// MCP per-user tokens + OAuth identity resolution — Lane A1 (2026-10-18).
//
// Background: the omnimind-mcp HTTP server was single-identity per process
// (one `omk_` agent key), so one URL could not serve two users. These shapes
// let a *gateway* agent (an Agent row holding the `mcp:delegate` scope)
// resolve a per-user principal and act on its behalf:
//
//   - `McpToken`          — a user-minted bearer token (`omt_…`), hashed at rest
//   - `McpOauthIdentity`  — an (issuer, subject) pair linked to a user
//   - `McpPrincipal`      — what the gateway gets back from introspect/resolve,
//                           and what `x-mcp-principal: token:<id>|oauth:<id>`
//                           resolves to on the OmniMind side.
//
// These are WIRE shapes (ISO-8601 strings, not Dates) like `mcp.schema.ts`,
// because they cross the HTTP seam between OmniMind, the MCP gateway and
// BoardRoom. The companion Zod schemas live in `validation/mcp-token.schema.ts`
// and must stay structurally identical.
//
// The scope constants live here (not in `constants/`) so the token lane owns a
// single pair of files; they are plain `as const` data with no behaviour.

// ── Scopes ──────────────────────────────────────────────────────────────────

/**
 * Canonical list of scopes a token or OAuth identity may be granted. Mirrors
 * the keygen / scope-enforcer vocabulary (docs/MEMORY-PROTOCOL.md › Scope
 * Reference, plus `project:write` and `code:write` used by registered agents).
 * Wildcards (`*`, `memory:*`) are deliberately NOT grantable to tokens.
 */
export const MCP_SCOPES = [
  'memory:read',
  'memory:write',
  'decision:write',
  'task:write',
  'commitment:write',
  'project:write',
  'code:write',
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

/**
 * Gateway-only scope: lets a registered Agent (x-agent-key) present
 * `x-mcp-principal` and call `POST /mcp/tokens/introspect` /
 * `POST /mcp/identities/resolve`. Never grantable to a token or identity, and
 * never inherited by a delegated context.
 */
export const MCP_DELEGATE_SCOPE = 'mcp:delegate' as const;

export const MCP_GATEWAY_SCOPES = [MCP_DELEGATE_SCOPE] as const;

export interface McpScopeDescriptor {
  id: McpScope;
  description: string;
  /** true when the scope permits mutations. */
  write: boolean;
}

export const MCP_SCOPE_DESCRIPTORS: readonly McpScopeDescriptor[] = [
  { id: 'memory:read', description: 'Search and read memories, tasks, projects, people, commitments and the graph', write: false },
  { id: 'memory:write', description: 'Write, supersede, reflect and consolidate memories; link people and goals', write: true },
  { id: 'decision:write', description: 'Log and update decisions', write: true },
  { id: 'task:write', description: 'Create, update, complete and block tasks', write: true },
  { id: 'commitment:write', description: 'Log and update commitments', write: true },
  { id: 'project:write', description: 'Create and update projects', write: true },
  { id: 'code:write', description: 'Record code-level context (repository notes, implementation memories)', write: true },
];

// ── Token constants ─────────────────────────────────────────────────────────

/** Raw token format: `omt_` + 32 random bytes, base64url (43 chars). */
export const MCP_TOKEN_PREFIX = 'omt_' as const;
export const MCP_TOKEN_RANDOM_BYTES = 32;
/** First N characters of the raw token, stored for display (`prefix`). */
export const MCP_TOKEN_DISPLAY_PREFIX_LENGTH = 12;
export const MCP_TOKEN_NAME_MIN_LENGTH = 1;
export const MCP_TOKEN_NAME_MAX_LENGTH = 60;
export const MCP_TOKEN_MAX_ACTIVE_PER_USER = 25;
export const MCP_TOKEN_EXPIRES_IN_DAYS_MIN = 1;
export const MCP_TOKEN_EXPIRES_IN_DAYS_MAX = 365;
/** `GET /mcp/tokens` hides tokens revoked longer ago than this. */
export const MCP_TOKEN_REVOKED_LIST_WINDOW_DAYS = 30;
export const MCP_SOURCE_WEIGHT_MIN = 0;
export const MCP_SOURCE_WEIGHT_MAX = 2;
/** Scopes an auto-linked OAuth identity starts with (read-only). */
export const MCP_OAUTH_DEFAULT_SCOPES: readonly McpScope[] = ['memory:read'];

/** Request header a gateway sends to act as a principal: `token:<id>` | `oauth:<id>`. */
export const MCP_PRINCIPAL_HEADER = 'x-mcp-principal' as const;

export type McpPrincipalKind = 'token' | 'oauth';

// ── Records ─────────────────────────────────────────────────────────────────

/** Public view of an `mcp_tokens` row. Never carries the hash. */
export interface McpTokenRecord {
  id: string;
  userId: string;
  tenantId: string;
  name: string;
  /** `mcp-token:<slug(name)>-<6 chars of id>` — stamped as agentId on writes. */
  agentName: string;
  /** First 12 characters of the raw token, for display. */
  prefix: string;
  scopes: McpScope[];
  sourceWeight: number;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

/** What a gateway acts as after introspect / resolve. */
export interface McpPrincipal {
  kind: McpPrincipalKind;
  /** The McpToken / McpOauthIdentity row id (what `x-mcp-principal` carries). */
  id: string;
  userId: string;
  tenantId: string;
  agentName: string;
  scopes: McpScope[];
  sourceWeight: number;
  /** Token display name (tokens only). */
  name?: string;
  /** ISO timestamp (tokens with an expiry only). */
  expiresAt?: string;
}

// ── Requests / responses ────────────────────────────────────────────────────

export interface McpTokenCreateRequest {
  userId: string;
  tenantId: string;
  name: string;
  scopes: McpScope[];
  sourceWeight?: number;
  expiresInDays?: number;
}

export interface McpTokenCreateResponse {
  /** Raw `omt_…` token — returned exactly once, never stored. */
  token: string;
  record: McpTokenRecord;
}

export interface McpTokenListResponse {
  tokens: McpTokenRecord[];
}

export interface McpTokenOptionsTenant {
  id: string;
  name: string;
}

export interface McpTokenOptions {
  tenants: McpTokenOptionsTenant[];
  scopes: McpScopeDescriptor[];
}

export interface McpTokenIntrospectRequest {
  token: string;
}

export type McpTokenInactiveReason = 'invalid' | 'expired' | 'revoked';

export interface McpPrincipalActive {
  active: true;
  principal: McpPrincipal;
}

export interface McpTokenIntrospectInactive {
  active: false;
  reason: McpTokenInactiveReason;
}

export type McpTokenIntrospectResponse = McpPrincipalActive | McpTokenIntrospectInactive;

export interface McpIdentityResolveRequest {
  issuer: string;
  subject: string;
  email?: string;
  emailVerified?: boolean;
  clientId?: string;
}

export interface McpIdentityResolveInactive {
  active: false;
  reason: 'unlinked';
}

export type McpIdentityResolveResponse = McpPrincipalActive | McpIdentityResolveInactive;

/** `GET /mcp/audit/stats` — latency + error profile of one tool (or all). */
export interface McpAuditStats {
  /** Tool filter that was applied; null when stats span every tool. */
  tool: string | null;
  sinceHours: number;
  count: number;
  p50Ms: number;
  p95Ms: number;
  /** Fraction of entries with an errorMessage, 0..1 (0 when count is 0). */
  errorRate: number;
}

export interface AdminTenantOwnerUpdateRequest {
  ownerUserId: string;
}

export interface AdminTenantRecord {
  id: string;
  name: string;
  ownerUserId: string | null;
}
