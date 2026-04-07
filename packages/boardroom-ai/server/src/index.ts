import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

const app = express();
const port = process.env.BOARDROOM_PORT || 3001;

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'boardroom-ai', timestamp: new Date().toISOString() });
});

// TODO: Wire routes (Phase 1)
// app.use('/api/sessions', sessionsRouter);
// app.use('/api/rooms', roomsRouter);
// app.use('/api/auth', authRouter);

app.listen(port, () => {
  console.log(`BoardRoom AI server running on port ${port}`);
});

export default app;
