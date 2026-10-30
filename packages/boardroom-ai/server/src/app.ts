// Express app factory. index.ts calls createApp() and listens; tests boot the
// SAME factory (with NODE_ENV=production) to assert middleware ordering.
//
// Middleware order is load-bearing — see docs/02-reference/FRAGILE-ZONES.md §2.

import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import { authMiddleware, optionalAuthMiddleware } from './middleware/auth';
import { requireAdmin } from './middleware/admin.middleware';
import { authRouter } from './routes/auth.routes';
import { healthRouter, readyRouter } from './routes/health.routes';
import { sessionsRouter } from './routes/sessions.routes';
import { entitiesRouter } from './routes/entities.routes';
import { onboardingRouter } from './routes/onboarding.routes';
import { onboardingBootstrapRouter } from './routes/onboarding-bootstrap.routes';
import { cortexRouter } from './routes/cortex.routes';
import { calendarRouter, calendarCallback } from './routes/calendar.routes';
import { subscriptionRouter, stripeWebhookHandler } from './routes/subscription.routes';
import { customPersonasRouter } from './routes/custom-personas.routes';
import { integrationsRouter, gmailCallback } from './routes/integrations.routes';
import { adminRouter } from './routes/admin.routes';
import { usageRouter } from './routes/usage.routes';
import { mcpTokensRouter } from './routes/mcp-tokens.routes';
import { requireSubscription } from './middleware/subscription.middleware';
import { llmRateLimiter } from './middleware/llm-rate-limiter';
import { logger } from './lib/logger';
import { resolveTrustProxy } from './lib/trust-proxy';

export interface CreateAppOptions {
  /** Override the client build directory (tests). Defaults to ../../client/dist. */
  clientDist?: string;
}

/** Hashed build output (`/assets/*`): content-addressed, safe to cache forever. */
export const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';
/** The SPA shell: always revalidate, so a deploy is picked up on the next load. */
export const INDEX_CACHE_CONTROL = 'no-cache';

/** `express.static` setHeaders: decided on the path inside the build dir (`assets/…`, `index.html`). */
function staticCacheHeaders(root: string): (res: Response, filePath: string) => void {
  return (res, filePath) => {
    const rel = path.relative(root, filePath).split(path.sep).join('/');
    if (rel.startsWith('assets/')) res.setHeader('Cache-Control', ASSET_CACHE_CONTROL);
    else if (rel === 'index.html') res.setHeader('Cache-Control', INDEX_CACHE_CONTROL);
  };
}

/** Never compress a Server-Sent Events stream (it would be buffered); otherwise the library default (compressible types). */
export function shouldCompress(req: Request, res: Response): boolean {
  const type = String(res.getHeader('Content-Type') ?? '');
  if (type.startsWith('text/event-stream')) return false;
  return compression.filter(req, res);
}

export function createApp(options: CreateAppOptions = {}): express.Express {
  const app = express();

  // B-104: Railway terminates TLS at a single proxy hop. Without this, req.ip is
  // the proxy address and every per-IP limiter becomes one site-wide bucket.
  // Lane G: the hop count is TRUST_PROXY_HOPS (default 1 in production, off
  // elsewhere) — trusting a hop with no proxy in front lets a client-written
  // X-Forwarded-For rotate the login limiter key. See lib/trust-proxy.ts.
  app.set('trust proxy', resolveTrustProxy());

  // ---------------------------------------------------------------------------
  // 1. Global middleware
  // ---------------------------------------------------------------------------
  app.use(helmet());
  const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
    : process.env.NODE_ENV === 'production'
      ? [] // Same-origin in production — no cross-origin needed
      : ['http://localhost:5173', 'http://localhost:3000'];

  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (same-origin, curl, etc.)
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        // B-116: disallowed origin → simply omit CORS headers (browser blocks
        // it). Throwing here produced a status-less Error → 500 + log noise.
        callback(null, false);
      }
    },
    credentials: true,
  }));

  // B-103: Stripe webhook needs the RAW body for signature verification and
  // has no cookie, so it is registered BEFORE express.json() and BEFORE the
  // auth wall. Both the bare and /api-prefixed paths are accepted because the
  // prefix-strip middleware runs after the JSON parser.
  const rawJson = express.raw({ type: 'application/json' });
  app.post('/subscription/webhook', rawJson, stripeWebhookHandler);
  app.post('/api/subscription/webhook', rawJson, stripeWebhookHandler);

  app.use(express.json());
  app.use(cookieParser());
  // Response compression (gzip / brotli, negotiated from Accept-Encoding) for the
  // static client and JSON alike. Global-middleware slot (step 1): it only wraps
  // the response, so the load-bearing order below is unchanged. SSE is excluded —
  // a compressed event stream is buffered until it ends, which would break
  // persona streaming (streaming.ts sets text/event-stream before the first write).
  app.use(compression({ filter: shouldCompress }));

  // ---------------------------------------------------------------------------
  // 2. Strip /api prefix — Vite dev proxy adds this, production serves both from
  //    same origin. req.originalUrl keeps the unstripped path for the SPA
  //    fallback predicate below.
  // ---------------------------------------------------------------------------
  app.use((req, _res, next) => {
    if (req.path.startsWith('/api/')) {
      req.url = req.url.replace(/^\/api/, '');
    }
    next();
  });

  // ---------------------------------------------------------------------------
  // 3. Public BROWSER-NAVIGATED GET routes — must sit ABOVE the SPA fallback.
  //
  // R-B-02: Google redirects the user's browser to the OAuth callbacks with
  // `Accept: text/html`. With these registered below the `app.get('*')`
  // fallback, the predicate in step 4 ("GET + prefers HTML") matched first and
  // served index.html, so the callback handler never ran and the token was
  // never stored. /health moves up for the same reason (a browser visit got
  // the SPA). B-107 still applies: direct handlers, not `app.get(path, router)`.
  // optionalAuth lets the handler cross-check state.userId against the cookie
  // when one IS present. /ready (M0-A2) sits here for the same reason as
  // /health: public, and a browser visit must get JSON, not the SPA shell.
  // ---------------------------------------------------------------------------
  app.use('/health', healthRouter);
  app.use('/ready', readyRouter);
  app.get('/calendar/callback', optionalAuthMiddleware, calendarCallback);
  app.get('/integrations/gmail/callback', optionalAuthMiddleware, gmailCallback);

  // ---------------------------------------------------------------------------
  // 4. Serve React client in production (before auth wall — static assets are public)
  // ---------------------------------------------------------------------------
  if (process.env.NODE_ENV === 'production') {
    const clientDist = options.clientDist ?? path.resolve(__dirname, '../../client/dist');
    const indexHtml = path.join(clientDist, 'index.html');
    // Vite fingerprints everything under /assets (name-<hash>.js|css|woff2), so
    // those never change at a URL: cache for a year, immutable. index.html names
    // the current hashes, so it must always be revalidated (no-cache).
    app.use(express.static(clientDist, { setHeaders: staticCacheHeaders(clientDist) }));

    // B-102 — SPA fallback predicate (replaces the hand-maintained prefix list):
    //   * GET only
    //   * ORIGINAL url did not start with /api/ (the strip middleware above
    //     already rewrote req.url, so req.path cannot tell us)
    //   * the client prefers HTML over JSON. Browser navigations send
    //     `text/html,...,*/*;q=0.8` → 'html'; fetch() sends `application/json`
    //     or bare `*/*` → 'json'. This is what lets /integrations and /admin
    //     be both a client route (navigation) and an API prefix (fetch).
    app.get('*', (req, res, next) => {
      if (req.originalUrl.startsWith('/api/')) { next(); return; }
      if (req.accepts(['json', 'html']) !== 'html') { next(); return; }
      if (!fs.existsSync(indexHtml)) { next(); return; }
      res.setHeader('Cache-Control', INDEX_CACHE_CONTROL);
      res.sendFile(indexHtml);
    });
  }

  // ---------------------------------------------------------------------------
  // 5. Remaining public routes (no auth required). These are fetch()-driven
  //    (JSON Accept), so the SPA predicate above already lets them through;
  //    the browser-navigated public GETs live in step 3.
  // ---------------------------------------------------------------------------
  app.use('/auth', authRouter);

  // ---------------------------------------------------------------------------
  // 6. Auth wall — all routes below require valid JWT
  // ---------------------------------------------------------------------------
  app.use(authMiddleware);

  // ---------------------------------------------------------------------------
  // 7. Protected routes
  // ---------------------------------------------------------------------------
  app.use('/subscription', subscriptionRouter);
  app.use('/sessions', requireSubscription, sessionsRouter);
  app.use('/onboarding', onboardingRouter);
  // B-110: LLM-backed, previously ungated.
  // Onboarding precedes checkout: no subscription gate here, LLM rate limit only (B-110)
  app.use('/onboarding-bootstrap', llmRateLimiter, onboardingBootstrapRouter);
  app.use('/', entitiesRouter);
  app.use('/cortex', requireSubscription, cortexRouter);
  app.use('/calendar', calendarRouter);
  app.use('/custom-personas', customPersonasRouter);
  app.use('/integrations', integrationsRouter); // extract/confirm routes gate themselves (B-110)
  app.use('/admin', requireAdmin, adminRouter); // B-101
  app.use('/usage', requireAdmin, usageRouter); // Phase 6 — LLM cost summary (admin-only)
  // Lane C — personal MCP tokens (Settings → Connected AI tools). Auth wall only:
  // the router gates POST (create) with requireSubscription itself, so a lapsed
  // subscriber can still list and revoke the tokens they already issued.
  app.use('/mcp/tokens', mcpTokensRouter);
  // app.use('/rooms', roomsRouter); // TODO: Phase 2

  // ---------------------------------------------------------------------------
  // 8. Error handler (must be last)
  // ---------------------------------------------------------------------------
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    const status = (err as Error & { status?: number }).status;
    const upstream = (err as Error & { upstream?: unknown }).upstream;

    // Upstream OmniMind errors
    if (upstream) {
      // B-106: pass 4xx through with the upstream body so validation details
      // (404/409/422) survive the seam. 401 is the one exception — it is the
      // service-to-service API key failing, never the user's credentials, so
      // surfacing it as 401 would log the user out; it stays a 502.
      if (status && status >= 400 && status < 500 && status !== 401) {
        res.status(status).json(upstream);
        return;
      }
      logger.error('Upstream OmniMind error', { message: err.message, status, path: req.path, method: req.method });
      res.status(502).json({
        error: 'upstream_error',
        message: err.message,
        service: 'omnimind',
      });
      return;
    }

    logger.error('Unhandled error', {
      message: err.message,
      path: req.path,
      method: req.method,
      stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
    });

    res.status(status || 500).json({
      error: 'internal_error',
      message: process.env.NODE_ENV === 'production' ? 'An internal error occurred' : err.message,
    });
  });

  return app;
}
