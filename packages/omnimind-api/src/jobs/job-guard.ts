import { logger } from '../lib/logger';

/**
 * O-109 — per-job overlap guard + O-108 — shutdown drain.
 *
 * Each cron job owns one guard. `run()` skips (and logs) when the previous
 * tick is still in flight, so a slow tick (50 outbox rows × 3 OpenAI
 * attempts, a long Haiku call, a full-table decay UPDATE) can never overlap
 * itself and double-increment attempts / duplicate summaries / double spend.
 *
 * All in-flight ticks are tracked in a module-level registry so index.ts can
 * await them before `prisma.$disconnect()` on SIGTERM.
 */

const inflight = new Map<string, Promise<unknown>>();

export interface JobGuard {
  readonly name: string;
  isRunning(): boolean;
  run<T>(fn: () => Promise<T>): Promise<T | undefined>;
}

export function createJobGuard(name: string): JobGuard {
  let current: Promise<unknown> | null = null;
  return {
    name,
    isRunning: () => current !== null,
    async run<T>(fn: () => Promise<T>): Promise<T | undefined> {
      if (current) {
        logger.warn(`[${name}] previous tick still running — skipping this tick (overlap guard)`);
        return undefined;
      }
      const p = fn();
      current = p;
      inflight.set(name, p);
      try {
        return await p;
      } finally {
        if (current === p) current = null;
        if (inflight.get(name) === p) inflight.delete(name);
      }
    },
  };
}

export function runningJobs(): string[] {
  return [...inflight.keys()];
}

/**
 * Resolves true when every in-flight tick has settled, false on timeout.
 * Ticks are not cancelled — the caller decides what to do on timeout.
 */
export async function waitForAllJobsIdle(timeoutMs = 20_000): Promise<boolean> {
  const pending = [...inflight.values()];
  if (pending.length === 0) return true;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>(resolve => {
    timer = setTimeout(() => resolve(false), timeoutMs);
    (timer as { unref?: () => void }).unref?.();
  });
  const settled = Promise.allSettled(pending).then(() => true);
  const result = await Promise.race([settled, timeout]);
  if (timer) clearTimeout(timer);
  return result;
}

export function __resetJobGuardRegistryForTest(): void {
  inflight.clear();
}
