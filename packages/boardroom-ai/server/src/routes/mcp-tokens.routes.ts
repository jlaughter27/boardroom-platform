// Lane C — personal MCP tokens ("Connected AI tools" in Settings).
//
// BoardRoom proxies to OmniMind's /mcp/tokens API (owned by Lane A1). The one
// invariant that matters here: `userId` is ALWAYS the JWT user. A client-supplied
// userId is stripped by the Zod schema (default strip) and never forwarded.
//
// Upstream 4xx (403 tenant_not_owned, 409 token_limit, 400 validation) flow
// through `next(err)` into app.ts's error handler, which passes the status and
// upstream body through unchanged (B-106) instead of collapsing them to 502.

import { Router } from 'express';
import type { IRouter } from 'express';
import { z } from 'zod';
import type { AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { omnimindClient } from '../services/omnimind-client';

// TODO(A1): switch to @boardroom/shared once exported
// (packages/shared/src/types/mcp-token.types.ts). Field names mirror A1's contract.
export interface McpTokenRecord {
  id: string;
  userId: string;
  tenantId: string;
  name: string;
  agentName: string;
  prefix: string;
  scopes: string[];
  sourceWeight: number;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface McpTokenCreateRequest {
  userId: string;
  tenantId: string;
  name: string;
  scopes: string[];
  sourceWeight?: number;
  expiresInDays?: number;
}

export interface McpTokenCreateResponse {
  token: string;
  record: McpTokenRecord;
}

export interface McpTokenListResponse {
  tokens: McpTokenRecord[];
}

export interface McpTokenOptions {
  tenants: Array<{ id: string; name: string }>;
  scopes: Array<{ id: string; description: string; write: boolean }>;
}

export interface McpConnectInfo {
  /** Public Streamable-HTTP MCP endpoint, or null when OMNIMIND_MCP_PUBLIC_URL is unset. */
  mcpUrl: string | null;
  appUrl: string;
  oauthEnabled: boolean;
}

/**
 * Body accepted from the browser. `userId` is intentionally absent — Zod's
 * default object mode strips unknown keys, so a spoofed userId never survives
 * validation, and the handler pins the JWT user below.
 */
export const McpTokenCreateBodySchema = z.object({
  tenantId: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(60),
  scopes: z.array(z.string().min(1).max(100)).min(1).max(50),
  sourceWeight: z.number().min(0).max(2).optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

const router: IRouter = Router();

// GET /mcp/tokens — the current user's tokens (hashes never leave OmniMind).
router.get('/', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.listMcpTokens(req.auth!.userId);
    res.json(data);
  } catch (err) { next(err); }
});

// GET /mcp/tokens/options — tenants the user owns + scope catalog for the form.
// Registered before any `/:id` pattern so the literal segment always wins.
router.get('/options', async (req: AuthRequest, res, next) => {
  try {
    const data = await omnimindClient.getMcpTokenOptions(req.auth!.userId);
    res.json(data);
  } catch (err) { next(err); }
});

// GET /mcp/tokens/connect-info — what the install snippets need. Read from
// BoardRoom env only; no upstream call.
router.get('/connect-info', (req: AuthRequest, res) => {
  const mcpUrl = process.env.OMNIMIND_MCP_PUBLIC_URL?.trim() || null;
  const appUrl = process.env.APP_PUBLIC_URL?.trim()
    || `${req.protocol}://${req.get('host') ?? 'localhost'}`;
  const oauthEnabled = Boolean(process.env.OMNIMIND_MCP_OAUTH_ISSUER?.trim());
  const body: McpConnectInfo = { mcpUrl, appUrl, oauthEnabled };
  res.json(body);
});

// POST /mcp/tokens — create. The raw token is returned exactly once.
router.post('/', validateBody(McpTokenCreateBodySchema), async (req: AuthRequest, res, next) => {
  try {
    const body = req.body as z.infer<typeof McpTokenCreateBodySchema>;
    const payload: McpTokenCreateRequest = { ...body, userId: req.auth!.userId };
    const data = await omnimindClient.createMcpToken(req.auth!.userId, payload);
    res.status(201).json(data);
  } catch (err) { next(err); }
});

// DELETE /mcp/tokens/:id — revoke (soft; OmniMind stamps revokedAt).
router.delete('/:id', async (req: AuthRequest, res, next) => {
  try {
    await omnimindClient.revokeMcpToken(req.auth!.userId, req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

export const mcpTokensRouter: IRouter = router;
