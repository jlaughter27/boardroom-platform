import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { authMiddleware } from './middleware/auth';
import { authRouter } from './routes/auth.routes';
import { healthRouter } from './routes/health.routes';
import { sessionsRouter } from './routes/sessions.routes';
import { entitiesRouter } from './routes/entities.routes';
import { onboardingRouter } from './routes/onboarding.routes';
import { onboardingBootstrapRouter } from './routes/onboarding-bootstrap.routes';
import { cortexRouter } from './routes/cortex.routes';
import { calendarRouter } from './routes/calendar.routes';
import { subscriptionRouter } from './routes/subscription.routes';
import { customPersonasRouter } from './routes/custom-personas.routes';
import { integrationsRouter } from './routes/integrations.routes';
import { adminRouter } from './routes/admin.routes';
import { requireSubscription } from './middleware/subscription.middleware';
import { logger } from './lib/logger';
import { validateBoardRoomEnv } from './lib/env';

if (process.env.NODE_ENV !== 'test') {
  validateBoardRoomEnv();
}

const app: ReturnType<typeof express> = express();
const port = process.env.PORT || process.env.BOARDROOM_PORT || 3001;

// Global middleware
app.use(helmet());
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : process.env.NODE_ENV === 'production'
    ? [] // Production: same-origin only — allow via !origin check below
    : ['http://localhost:5173', 'http://localhost:3000'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, server-to-server, etc.)
    if (!origin) {
      callback(null, true);
      return;
    }
    // In production with no CORS_ORIGINS set, allow same-origin requests.
    // Browsers send the Origin header even on same-origin POSTs, so we must
    // accept the request instead of rejecting it.
    if (ALLOWED_ORIGINS.length === 0) {
      callback(null, true);
      return;
    }
    if (ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Strip /api prefix — Vite dev proxy adds this, production serves both from same origin
app.use((req, _res, next) => {
  if (req.path.startsWith('/api/')) {
    req.url = req.url.replace(/^\/api/, '');
  }
  next();
});

// Serve React client in production (before auth wall — static assets are public)
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  // SPA fallback — serve index.html for any non-API route
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/health') || req.path.startsWith('/auth')
        || req.path.startsWith('/sessions') || req.path.startsWith('/subscription')
        || req.path.startsWith('/onboarding') || req.path.startsWith('/cortex')
        || req.path.startsWith('/calendar') || req.path.startsWith('/custom-personas')
        || req.path.startsWith('/integrations') || req.path.startsWith('/admin')) {
      // /onboarding matches both /onboarding and /onboarding-bootstrap — no extra clause needed
      next(); // Pass to API routes
      return;
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Public routes (no auth required)
app.use('/health', healthRouter);
app.use('/auth', authRouter);
// OAuth callbacks must be accessible without auth (Google redirects here)
app.get('/calendar/callback', calendarRouter);
app.get('/integrations/gmail/callback', integrationsRouter);

// Auth wall — all routes below require valid JWT
app.use(authMiddleware);

// Protected routes
app.use('/subscription', subscriptionRouter);
app.use('/sessions', requireSubscription, sessionsRouter);
app.use('/onboarding', onboardingRouter);
app.use('/onboarding-bootstrap', onboardingBootstrapRouter);
app.use('/', entitiesRouter);
app.use('/cortex', cortexRouter);
app.use('/calendar', calendarRouter);
app.use('/custom-personas', customPersonasRouter);
app.use('/integrations', integrationsRouter);
app.use('/admin', adminRouter);
// app.use('/rooms', roomsRouter); // TODO: Phase 2

// Error handler (must be last)
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const status = (err as Error & { status?: number }).status;
  const upstream = (err as Error & { upstream?: unknown }).upstream;

  // Upstream OmniMind errors
  if (upstream) {
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

// Graceful shutdown
const server = app.listen(port, () => {
  console.log(`BoardRoom AI server running on port ${port}`);
});

const shutdown = () => {
  logger.info('Shutting down BoardRoom AI...');
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;
