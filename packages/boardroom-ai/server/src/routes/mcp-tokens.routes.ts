// Lane C — personal MCP tokens ("Connected AI tools" in Settings).
//
// BoardRoom proxies to OmniMind's /mcp/tokens API (owned by Lane A1). The one
// invariant that matters here: `userId` is ALWAYS the JWT user. A client-supplied
// userId is stripped by the Zod schema (default strip) and never forwarded.
//
// Upstream 4xx (403 tenant_not_owned, 409 token_limit, 400 validation) flow
// through `next(err)` into app.ts's error handler, which passes the status and
// upstream body through unchanged (B-106) instead of collapsing them to 502.
//
// Gating: the router is mounted behind the auth wall only. Creating a token is
// additionally gated by `requireSubscription`; listing, revoking, the scope
// catalog and connect-info are not, so a lapsed subscriber can always see and
// revoke the tokens they already issued.

import { Router } from 'express';
import type { IRouter } from 'express';
import type { z } from 'zod';
import { McpTokenCreateRequestSchema, type McpTokenCreateRequest } from '@boardroom/shared';
import type { AuthRequest } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { requireSubscription } from '../middleware/subscription.middleware';
import { omnimindClient } from '../services/omnimind-client';

/** What the install snippets need. BoardRoom-only shape (no upstream call). */
export interface McpConnectInfo {
  /** Public Streamable-HTTP MCP endpoint, or null when OMNIMIND_MCP_PUBLIC_URL is unset. */
  mcpUrl: string | null;
  /** Public URL of this app from APP_PUBLIC_URL, or null when unset. Never derived from the request. */
  appUrl: string | null;
  oauthEnabled: boolean;
}

/**
 * Body accepted from the browser: the shared create-request contract minus
 * `userId`. Zod's default object mode strips unknown keys, so a spoofed userId
 * never survives validation, and the handler pins the JWT user below.
 *
 * `expiresInDays: null` means "never expires"; an omitted value lets OmniMind
 * apply its default (365 days). Both come straight from the shared schema.
 */
export const McpTokenCreateBodySchema = McpTokenCreateRequestSchema.omit({ userId: true });

export type McpTokenCreateBody = z.infer<typeof McpTokenCreateBodySchema>;

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
// BoardRoom env only; no upstream call, nothing reflected from the request.
router.get('/connect-info', (_req: AuthRequest, res) => {
  const mcpUrl = process.env.OMNIMIND_MCP_PUBLIC_URL?.trim() || null;
  const appUrl = process.env.APP_PUBLIC_URL?.trim() || null;
  const oauthEnabled = Boolean(process.env.OMNIMIND_MCP_OAUTH_ISSUER?.trim());
  const body: McpConnectInfo = { mcpUrl, appUrl, oauthEnabled };
  res.json(body);
});

// POST /mcp/tokens — create. The raw token is returned exactly once. This is
// the only subscription-gated route in the file.
router.post('/', requireSubscription, validateBody(McpTokenCreateBodySchema), async (req: AuthRequest, res, next) => {
  try {
    const body = req.body as McpTokenCreateBody;
    const payload: McpTokenCreateRequest = { ...body, userId: req.auth!.userId };
    const data = await omnimindClient.createMcpToken(req.auth!.userId, payload);
    res.status(201).json(data);
  } catch (err) { next(err); }
});

// DELETE /mcp/tokens/:id — revoke (soft; OmniMind stamps revokedAt). Never
// subscription-gated: revoking must always work.
router.delete('/:id', async (req: AuthRequest, res, next) => {
  try {
    await omnimindClient.revokeMcpToken(req.auth!.userId, req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

export const mcpTokensRouter: IRouter = router;
