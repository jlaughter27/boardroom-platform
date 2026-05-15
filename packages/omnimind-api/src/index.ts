import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { prisma } from './lib/db';
import { logger } from './lib/logger';
import { apiKeyAuth } from './middleware/auth';
import { agentContextMiddleware } from './middleware/agent-context';
import { rateLimiter, stopRateLimiter } from './middleware/rate-limiter';
import { agentRateLimiter, stopAgentRateLimiter } from './middleware/agent-rate-limiter';
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
import { validateOmniMindEnv } from './lib/env';

if (process.env.NODE_ENV !== 'test') {
  validateOmniMindEnv();
}

const app: Express = express();
const port = parseInt(process.env.PORT || process.env.OMNIMIND_PORT || '3333', 10);

// Global middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(apiKeyAuth);
// agent-context MUST follow apiKeyAuth: it reads x-api-key for Agent fallback lookup.
app.use(agentContextMiddleware);
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
app.use('/admin', adminRouter);

// Error handler (must be last)
app.use(errorHandler);

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down OmniMind API...');
  stopCortexScheduler();
  stopSessionSummarizer();
  stopWeeklyDigestScheduler();
  stopImportanceDecayScheduler();
  stopEmbeddingRetryScheduler();
  // F-209: clear the rate-limiter cleanup intervals so we can exit cleanly.
  stopRateLimiter();
  stopAgentRateLimiter();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start (skip in test — supertest binds its own port)
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    logger.info(`OmniMind API running on port ${port}`, { port });
    startCortexScheduler();
    startSessionSummarizer();
    startWeeklyDigestScheduler();
    startImportanceDecayScheduler();
    startEmbeddingRetryScheduler();
  });
}

export default app;
