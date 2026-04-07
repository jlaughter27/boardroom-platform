import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { prisma } from './lib/db';
import { logger } from './lib/logger';
import { apiKeyAuth } from './middleware/auth';
import { rateLimiter } from './middleware/rate-limiter';
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

const app: Express = express();
const port = parseInt(process.env.OMNIMIND_PORT || '3333', 10);

// Global middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(apiKeyAuth);
app.use(rateLimiter);

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
// app.use('/context', contextRouter);

// Error handler (must be last)
app.use(errorHandler);

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down OmniMind API...');
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start
app.listen(port, () => {
  logger.info(`OmniMind API running on port ${port}`, { port });
});

export default app;
