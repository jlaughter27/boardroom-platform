import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

const app = express();
const port = process.env.OMNIMIND_PORT || 3333;

app.use(helmet());
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'omnimind-api', timestamp: new Date().toISOString() });
});

// TODO: Wire routes (TASK-002)
// app.use('/memories', memoriesRouter);
// app.use('/people', peopleRouter);
// app.use('/goals', goalsRouter);
// app.use('/projects', projectsRouter);
// app.use('/tasks', tasksRouter);
// app.use('/decisions', decisionsRouter);
// app.use('/commitments', commitmentsRouter);
// app.use('/user-profile', userProfileRouter);
// app.use('/context', contextRouter);

app.listen(port, () => {
  console.log(`OmniMind API running on port ${port}`);
});

export default app;
