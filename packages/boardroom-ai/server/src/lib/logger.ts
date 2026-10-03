interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  traceId?: string;
  [key: string]: unknown;
}

function log(level: LogEntry['level'], message: string, extra?: Record<string, unknown>): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...extra,
  };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

// Phase 6 — debug lines (cache_read_input_tokens, usage posts) only print when
// LOG_LEVEL=debug so production stdout stays quiet.
const DEBUG_ENABLED = (process.env.LOG_LEVEL ?? '').toLowerCase() === 'debug';

export const logger = {
  debug: (message: string, extra?: Record<string, unknown>) => { if (DEBUG_ENABLED) log('debug', message, extra); },
  info: (message: string, extra?: Record<string, unknown>) => log('info', message, extra),
  warn: (message: string, extra?: Record<string, unknown>) => log('warn', message, extra),
  error: (message: string, extra?: Record<string, unknown>) => log('error', message, extra),
};
