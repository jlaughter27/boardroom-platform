// Phase 6 — OpenTelemetry MUST load before express/http are required so the
// auto-instrumentations can patch them. No-op unless OTEL_EXPORTER_OTLP_ENDPOINT is set.
import './lib/otel';
import { createApp } from './app';
import { logger } from './lib/logger';
import { validateBoardRoomEnv } from './lib/env';
import { sessionStore } from './routes/sessions.routes';

if (process.env.NODE_ENV !== 'test') {
  validateBoardRoomEnv();
}

// The app itself (middleware order, routes, error handler) lives in app.ts so
// tests can boot the exact production wiring without calling listen().
const app = createApp();
const port = process.env.PORT || process.env.BOARDROOM_PORT || 3001;

// Graceful shutdown
const server = app.listen(port, () => {
  console.log(`BoardRoom AI server running on port ${port}`);
});

const shutdown = () => {
  logger.info('Shutting down BoardRoom AI...');
  // RD-17: write through any coalesced Decision Lab session state before exit
  // (flushAll never throws; a failed write is logged).
  void sessionStore.flushAll().finally(() => {
    server.close(() => {
      process.exit(0);
    });
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;
