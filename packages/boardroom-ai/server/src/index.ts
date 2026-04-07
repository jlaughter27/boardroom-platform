import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { authMiddleware } from './middleware/auth';
import { authRouter } from './routes/auth.routes';
import { healthRouter } from './routes/health.routes';

const app = express();
const port = process.env.BOARDROOM_PORT || 3001;

// Global middleware
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Public routes (no auth required)
app.use('/health', healthRouter);
app.use('/auth', authRouter);

// Auth wall — all routes below require valid JWT
app.use(authMiddleware);

// TODO: Wire protected routes (Phase 1)
// app.use('/sessions', sessionsRouter);
// app.use('/rooms', roomsRouter);

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

  console.error('Unhandled error:', {
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
  console.log('Shutting down BoardRoom AI...');
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;
