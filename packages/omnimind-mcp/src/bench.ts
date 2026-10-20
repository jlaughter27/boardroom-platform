/**
 * `node dist/index.js bench --n 10` — end-to-end `memory_write` latency
 * against the configured OmniMind API (Haiku fact extraction included).
 * Prints local p50 / p95 and, when `GET /mcp/audit/stats` is reachable, the
 * server-side figures for the same tool. If p95 is above ~20 s, flip
 * `OMNIMIND_MCP_WRITE_EXTRACT=async` (see memory.tool.ts) — Claude Code
 * backgrounds MCP calls past two minutes and several clients time out at 60 s.
 *
 * The run WRITES real memories (tags `bench`, importance 0.1) in the agent's
 * tenant for the given user; idempotency keys are `bench-<runId>-<i>`. L-9:
 * `--cleanup` (default on) archives every row the run created (`DELETE
 * /memories/:id`); outside `NODE_ENV=development` the run refuses to start
 * without `--yes`, because it spends real Haiku tokens and writes real rows.
 */
import { randomUUID } from 'crypto';
import { createOmniMindClient } from './lib/client';
import type { AuditStats } from './lib/client';
import { resolveAgentFromEnv } from './lib/auth';
import { memoryWriteTool, resolveWriteExtractMode } from './tools/memory.tool';

export const BENCH_DEFAULT_N = 10;
export const BENCH_MAX_N = 200;
/** Research threshold: above this p95 the write path should extract asynchronously. */
export const BENCH_ASYNC_THRESHOLD_MS = 20_000;

export interface BenchArgs {
  n: number;
  userId?: string;
  domain: string;
  sinceHours: number;
  /** Archive the rows this run wrote when it finishes (default true; `--no-cleanup` keeps them). */
  cleanup: boolean;
  /** `--yes` — acknowledges real writes + LLM spend; required unless NODE_ENV=development. */
  yes: boolean;
}

/** L-9 — a bench run is a real write with real cost; outside development it needs an explicit `--yes`. */
export function assertBenchConfirmed(args: Pick<BenchArgs, 'yes'>, env: NodeJS.ProcessEnv = process.env): void {
  if (args.yes || env.NODE_ENV === 'development') return;
  throw new Error(`bench writes real memories and spends Haiku tokens against ${env.OMNIMIND_API_URL ?? 'OMNIMIND_API_URL'}; pass --yes to confirm (or run with NODE_ENV=development)`);
}

export function parseBenchArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): BenchArgs {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  const nRaw = get('--n');
  const n = nRaw === undefined ? BENCH_DEFAULT_N : Number(nRaw);
  if (!Number.isInteger(n) || n < 1 || n > BENCH_MAX_N) {
    throw new Error(`--n must be an integer between 1 and ${BENCH_MAX_N} (got ${JSON.stringify(nRaw)})`);
  }
  const sinceRaw = get('--since-hours');
  const sinceHours = sinceRaw === undefined ? 24 : Number(sinceRaw);
  if (!Number.isFinite(sinceHours) || sinceHours <= 0) throw new Error('--since-hours must be a positive number');
  const userId = get('--user') ?? env.OMNIMIND_MCP_USER_ID?.trim() ?? env.OMNIMIND_MCP_SMOKE_USER_ID?.trim() ?? undefined;
  if (argv.includes('--cleanup') && argv.includes('--no-cleanup')) throw new Error('--cleanup and --no-cleanup are mutually exclusive');
  const cleanup = !argv.includes('--no-cleanup');
  const yes = argv.includes('--yes') || argv.includes('-y');
  return { n, ...(userId ? { userId } : {}), domain: get('--domain') ?? 'general', sinceHours, cleanup, yes };
}

/** Nearest-rank percentile on an ascending-sorted sample. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export interface LatencySummary {
  n: number;
  p50Ms: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  meanMs: number;
}

export function summarize(samples: number[]): LatencySummary {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  return {
    n,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    minMs: n ? sorted[0] : 0,
    maxMs: n ? sorted[n - 1] : 0,
    meanMs: n ? Math.round(sorted.reduce((a, b) => a + b, 0) / n) : 0,
  };
}

export interface BenchDeps {
  /** Perform write #i (0-based); the bench times it end to end. Returns the ids it created / updated so `cleanup` can archive them. */
  write: (i: number) => Promise<unknown>;
  /** `GET /mcp/audit/stats` for memory_write; optional. */
  stats?: () => Promise<AuditStats>;
  /** L-9 — archive one row this run wrote; called for every id when `cleanup` is on. */
  cleanup?: (id: string) => Promise<void>;
  log?: (line: string) => void;
  now?: () => number;
}

export interface BenchReport {
  local: LatencySummary;
  /** Writes that threw (their latency is still counted). */
  errors: number;
  /** Server-side figures when the audit stats endpoint answered. */
  server?: AuditStats;
  serverError?: string;
  /** True when local p95 exceeds BENCH_ASYNC_THRESHOLD_MS. */
  recommendAsync: boolean;
  /** Rows archived by `--cleanup` (and how many archive calls failed). */
  cleanedUp?: { archived: number; failed: number };
}

/** Ids a `memory_write` result reports (`created` + `updated`), if it is one. */
function writtenIds(result: unknown): string[] {
  if (!result || typeof result !== 'object') return [];
  const r = result as { created?: unknown; updated?: unknown };
  const ids = [...(Array.isArray(r.created) ? r.created : []), ...(Array.isArray(r.updated) ? r.updated : [])];
  return ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
}

export async function runBench(args: Pick<BenchArgs, 'n'> & Partial<Pick<BenchArgs, 'cleanup'>>, deps: BenchDeps): Promise<BenchReport> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const now = deps.now ?? (() => Date.now());
  const samples: number[] = [];
  const written = new Set<string>();
  let errors = 0;
  for (let i = 0; i < args.n; i++) {
    const start = now();
    try {
      const result = await deps.write(i);
      for (const id of writtenIds(result)) written.add(id);
      const ms = now() - start;
      samples.push(ms);
      log(`[bench] write ${i + 1}/${args.n}: ${ms} ms`);
    } catch (err) {
      const ms = now() - start;
      samples.push(ms);
      errors++;
      log(`[bench] write ${i + 1}/${args.n}: FAILED after ${ms} ms — ${(err as Error).message}`);
    }
  }
  const local = summarize(samples);
  log(`[bench] local (end to end, n=${local.n}${errors ? `, ${errors} failed` : ''}): p50 ${local.p50Ms} ms, p95 ${local.p95Ms} ms, min ${local.minMs} ms, max ${local.maxMs} ms, mean ${local.meanMs} ms`);

  const report: BenchReport = { local, errors, recommendAsync: local.p95Ms > BENCH_ASYNC_THRESHOLD_MS };
  if (deps.stats) {
    try {
      report.server = await deps.stats();
      log(`[bench] server (GET /mcp/audit/stats, tool=memory_write, last ${report.server.sinceHours} h, n=${report.server.count}): p50 ${report.server.p50Ms} ms, p95 ${report.server.p95Ms} ms, error rate ${(report.server.errorRate * 100).toFixed(1)}%`);
    } catch (err) {
      report.serverError = (err as Error).message;
      log(`[bench] server stats unavailable (${report.serverError}) — local timing is authoritative for this run.`);
    }
  }
  if (report.recommendAsync) {
    log(`[bench] p95 ${local.p95Ms} ms exceeds ${BENCH_ASYNC_THRESHOLD_MS} ms: set OMNIMIND_MCP_WRITE_EXTRACT=async so memory_write returns the row id immediately and extracts afterwards.`);
  } else {
    log(`[bench] p95 within the ${BENCH_ASYNC_THRESHOLD_MS} ms budget; OMNIMIND_MCP_WRITE_EXTRACT=sync is fine.`);
  }
  if ((args.cleanup ?? true) && deps.cleanup) {
    let archived = 0;
    let failed = 0;
    for (const id of written) {
      try {
        await deps.cleanup(id);
        archived++;
      } catch (err) {
        failed++;
        log(`[bench] cleanup: could not archive ${id} — ${(err as Error).message}`);
      }
    }
    report.cleanedUp = { archived, failed };
    log(`[bench] cleanup: archived ${archived} bench row(s)${failed ? `, ${failed} failed` : ''}${written.size === 0 ? ' (nothing to archive)' : ''}.`);
  } else if (written.size > 0) {
    log(`[bench] cleanup skipped (--no-cleanup): ${written.size} bench row(s) kept, tagged "bench".`);
  }
  return report;
}

/** CLI entry: `omnimind-mcp bench --yes [--n 10] [--user <id>] [--domain general] [--since-hours 24] [--no-cleanup]`. */
export async function runBenchCli(argv: string[] = process.argv.slice(3)): Promise<void> {
  let args: BenchArgs;
  try {
    args = parseBenchArgs(argv);
    assertBenchConfirmed(args);
  } catch (err) {
    console.error(`[bench] ${(err as Error).message}`);
    console.error('Usage: omnimind-mcp bench --yes [--n <1..200>] [--user <userId>] [--domain <domain>] [--since-hours <h>] [--no-cleanup]');
    process.exit(1);
  }
  for (const v of ['OMNIMIND_API_URL', 'OMNIMIND_API_KEY', 'OMNIMIND_MCP_AGENT_NAME', 'OMNIMIND_MCP_TENANT_ID']) {
    if (!process.env[v]) {
      console.error(`[bench] Missing required env var: ${v}`);
      process.exit(1);
    }
  }
  if (!args.userId) {
    console.error('[bench] A user is required: pass --user <id> or set OMNIMIND_MCP_USER_ID.');
    process.exit(1);
  }
  const userId = args.userId;
  const agentCtx = resolveAgentFromEnv();
  const client = createOmniMindClient();
  client.setAgentHeaders({ agentId: agentCtx.agentId, tenantId: agentCtx.tenantId, sourceWeight: agentCtx.sourceWeight });
  const mode = resolveWriteExtractMode();
  const tool = memoryWriteTool(client, agentCtx, { extractMode: mode });
  const runId = randomUUID().slice(0, 8);
  console.log(`[bench] memory_write x${args.n} as ${agentCtx.agentName}@${agentCtx.tenantId} for user ${userId} (domain ${args.domain}, extract mode ${mode}, run ${runId}, cleanup ${args.cleanup ? 'on' : 'off'})`);

  const report = await runBench(args, {
    write: async i => {
      const result = await tool.execute({
        content: `Bench write ${i + 1} of ${args.n} at ${new Date().toISOString()} (run ${runId}): measuring memory_write latency end to end, including fact extraction and dedup.`,
        domain: args.domain,
        tags: ['bench'],
        importance: 0.1,
        userId,
        idempotencyKey: `bench-${runId}-${i}`,
      });
      if (!result.ok) throw new Error(`${result.error}: ${result.message}`);
      return result;
    },
    stats: () => client.getAuditStats({ tool: 'memory_write', sinceHours: args.sinceHours }),
    cleanup: id => client.archiveMemory(id, userId),
  });
  if (report.errors === args.n) process.exit(1);
}
