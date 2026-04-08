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
import { cortexRouter } from './routes/cortex.routes';
import { calendarRouter } from './routes/calendar.routes';
import { subscriptionRouter } from './routes/subscription.routes';
import { customPersonasRouter } from './routes/custom-personas.routes';
import { integrationsRouter } from './routes/integrations.routes';
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
    ? [] // Same-origin in production — no cross-origin needed
    : ['http://localhost:5173', 'http://localhost:3000'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (same-origin, curl, etc.)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

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
app.use('/', entitiesRouter);
app.use('/cortex', cortexRouter);
app.use('/calendar', calendarRouter);
app.use('/custom-personas', customPersonasRouter);
app.use('/integrations', integrationsRouter);
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

// Serve React client in production
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  // SPA fallback — serve index.html for any non-API route
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/health') || req.path.startsWith('/auth')) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

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
