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
import { authMiddleware, optionalAuthMiddleware } from './middleware/auth';
import { requireAdmin } from './middleware/admin.middleware';
import { authRouter } from './routes/auth.routes';
import { healthRouter } from './routes/health.routes';
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
import { requireSubscription } from './middleware/subscription.middleware';
import { llmRateLimiter } from './middleware/llm-rate-limiter';
import { logger } from './lib/logger';

export interface CreateAppOptions {
  /** Override the client build directory (tests). Defaults to ../../client/dist. */
  clientDist?: string;
}

export function createApp(options: CreateAppOptions = {}): express.Express {
  const app = express();

  // B-104: Railway terminates TLS at a single proxy hop. Without this, req.ip is
  // the proxy address and every per-IP limiter becomes one site-wide bucket.
  app.set('trust proxy', 1);

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
  // 3. Serve React client in production (before auth wall — static assets are public)
  // ---------------------------------------------------------------------------
  if (process.env.NODE_ENV === 'production') {
    const clientDist = options.clientDist ?? path.resolve(__dirname, '../../client/dist');
    const indexHtml = path.join(clientDist, 'index.html');
    app.use(express.static(clientDist));

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
      res.sendFile(indexHtml);
    });
  }

  // ---------------------------------------------------------------------------
  // 4. Public routes (no auth required)
  // ---------------------------------------------------------------------------
  app.use('/health', healthRouter);
  app.use('/auth', authRouter);
  // B-107: OAuth callbacks registered as direct handlers (Google redirects here
  // without a guaranteed cookie). optionalAuth lets the handler cross-check
  // state.userId against the cookie when one IS present.
  app.get('/calendar/callback', optionalAuthMiddleware, calendarCallback);
  app.get('/integrations/gmail/callback', optionalAuthMiddleware, gmailCallback);

  // ---------------------------------------------------------------------------
  // 5. Auth wall — all routes below require valid JWT
  // ---------------------------------------------------------------------------
  app.use(authMiddleware);

  // ---------------------------------------------------------------------------
  // 6. Protected routes
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
  // app.use('/rooms', roomsRouter); // TODO: Phase 2

  // ---------------------------------------------------------------------------
  // 7. Error handler (must be last)
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
