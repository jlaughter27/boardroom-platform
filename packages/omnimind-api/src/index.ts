import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { Server } from 'http';
import { prisma } from './lib/db';
import { logger } from './lib/logger';
import { apiKeyAuth } from './middleware/auth';
import { agentContextMiddleware } from './middleware/agent-context';
import { agentScopeEnforcer } from './middleware/scope-enforcer';
import { rateLimiter, stopRateLimiterCleanup } from './middleware/rate-limiter';
import { agentRateLimiter, stopAgentRateLimiterCleanup } from './middleware/agent-rate-limiter';
import { requireAdminKey } from './middleware/admin-auth';
import { errorHandler } from './middleware/error-handler';
import { healthRouter } from './routes/health.routes';
import { memoriesRouter } from './routes/memories.routes';
import { peopleRouter } from './routes/people.routes';
import { goalsRouter } from './routes/goals.routes';
import { projectsRouter } from './routes/projects.routes';
import { tasksRouter } from './routes/tasks.routes';
import { decisionsRouter } from './routes/decisions.routes';
import { commitmentsRouter } from './routes/commitments.routes';
import { userProfileRouter } from './routes/user-profile.routes';
import { contextRouter } from './routes/context.routes';
import { authRouter } from './routes/auth.routes';
import { outcomeReviewRouter } from './routes/outcome-review.routes';
import { cortexRouter } from './routes/cortex.routes';
import { oauthRouter } from './routes/oauth.routes';
import { subscriptionRouter } from './routes/subscription.routes';
import { customPersonasRouter } from './routes/custom-personas.routes';
import { relationshipsRouter } from './routes/relationships.routes';
import mcpRouter from './routes/mcp.routes';
import adminRouter from './routes/admin.routes';
import { startCortexScheduler, stopCortexScheduler } from './jobs/cortex-scheduler';
import { startSessionSummarizer, stopSessionSummarizer } from './jobs/session-summarizer';
import { startWeeklyDigestScheduler, stopWeeklyDigestScheduler } from './jobs/weekly-digest-scheduler';
import { startImportanceDecayScheduler, stopImportanceDecayScheduler } from './jobs/importance-decay-scheduler';
import { startEmbeddingRetryScheduler, stopEmbeddingRetryScheduler } from './jobs/embedding-retry-scheduler';
import { waitForAllJobsIdle, runningJobs } from './jobs/job-guard';
import { validateOmniMindEnv } from './lib/env';

if (process.env.NODE_ENV !== 'test') {
  validateOmniMindEnv();
}

const app: Express = express();
// PORT is injected by Railway and always wins; OMNIMIND_PORT is the documented
// local-dev fallback (see .env.example). F-216.
const port = parseInt(process.env.PORT || process.env.OMNIMIND_PORT || '3333', 10);

// F-105/F-207: Railway terminates TLS at a proxy — without this req.ip is the
// proxy address and every IP-keyed rate-limit bucket is shared site-wide.
app.set('trust proxy', 1);

// Global middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(apiKeyAuth);
// agent-context MUST follow apiKeyAuth: it resolves x-agent-key against the
// agents table and attaches req.agentContext (M-103).
app.use(agentContextMiddleware);
// Scope enforcement needs the verified context from the line above.
app.use(agentScopeEnforcer);
app.use(rateLimiter);
app.use(agentRateLimiter);

// Routes
app.use('/health', healthRouter);

// Entity routes
app.use('/memories', memoriesRouter);
app.use('/people', peopleRouter);
app.use('/goals', goalsRouter);
app.use('/projects', projectsRouter);
app.use('/tasks', tasksRouter);
app.use('/decisions', decisionsRouter);
app.use('/commitments', commitmentsRouter);
app.use('/user-profile', userProfileRouter);
app.use('/context', contextRouter);
app.use('/auth', authRouter);
app.use('/outcome-reviews', outcomeReviewRouter);
app.use('/cortex', cortexRouter);
app.use('/oauth', oauthRouter);
app.use('/subscription', subscriptionRouter);
app.use('/custom-personas', customPersonasRouter);
app.use('/relationships', relationshipsRouter);
app.use('/mcp', mcpRouter);
// F-104: admin surface requires its own key (x-admin-key / OMNIMIND_ADMIN_KEY).
app.use('/admin', requireAdminKey, adminRouter);

// Error handler (must be last)
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Graceful shutdown (O-108)
//
// Order matters:
//   1. stop accepting new connections and let in-flight requests finish
//   2. stop the cron schedulers (no new ticks) and wait for running ticks
//   3. clear the rate-limiter cleanup timers (F-209/F-211)
//   4. disconnect Prisma — only now is it safe; before this change every
//      Railway deploy cut requests and outbox ticks mid-query
//   5. exit
// A hard deadline guarantees the process exits even if something hangs.
// ---------------------------------------------------------------------------
const SHUTDOWN_DEADLINE_MS = parseInt(process.env.SHUTDOWN_DEADLINE_MS ?? '25000', 10);
let server: Server | null = null;
let shuttingDown = false;

async function closeServer(): Promise<void> {
  if (!server) return;
  const s = server;
  await new Promise<void>(resolve => {
    s.close(err => {
      if (err) logger.warn('HTTP server close reported an error', { error: err.message });
      resolve();
    });
    // Node ≥18.2: drop idle keep-alive sockets so close() can complete.
    (s as Server & { closeIdleConnections?: () => void }).closeIdleConnections?.();
  });
}

const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutting down OmniMind API...', { signal });

  const deadline = setTimeout(() => {
    logger.error('Shutdown deadline exceeded — forcing exit', { stillRunning: runningJobs() });
    process.exit(1);
  }, SHUTDOWN_DEADLINE_MS);
  deadline.unref();

  try {
    await closeServer();
    logger.info('HTTP server closed');

    stopCortexScheduler();
    stopSessionSummarizer();
    stopWeeklyDigestScheduler();
    stopImportanceDecayScheduler();
    stopEmbeddingRetryScheduler();

    const idle = await waitForAllJobsIdle(Math.max(1000, SHUTDOWN_DEADLINE_MS - 5000));
    if (!idle) {
      logger.warn('Some job ticks did not finish before shutdown', { stillRunning: runningJobs() });
    }

    stopRateLimiterCleanup();
    stopAgentRateLimiterCleanup();

    await prisma.$disconnect();
    logger.info('Shutdown complete');
    clearTimeout(deadline);
    process.exit(0);
  } catch (err) {
    logger.error('Shutdown error', { error: (err as Error).message });
    process.exit(1);
  }
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// Start (skip in test — supertest binds its own port)
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(port, () => {
    logger.info(`OmniMind API running on port ${port}`, { port });
    startCortexScheduler();
    startSessionSummarizer();
    startWeeklyDigestScheduler();
    startImportanceDecayScheduler();
    startEmbeddingRetryScheduler();
  });
}

export default app;
