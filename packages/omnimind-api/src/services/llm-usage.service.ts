import type { PrismaClient } from '@prisma/client';
import { estimateCostUsd } from '@boardroom/shared';
import type {
  LlmUsageCreateRequest,
  LlmUsageCreateResponse,
  LlmUsageSummary,
  LlmUsageByDay,
  LlmUsageByPurpose,
  LlmUsageByModel,
} from '@boardroom/shared';
import { logger } from '../lib/logger';

/**
 * Phase 6 — LlmUsage accounting (contract: PHASE-6-CONTRACTS.md §LlmUsage).
 *
 * `recordLlmUsage` is the single write path for `llm_usage`. The server
 * computes `costUsd` from `MODEL_PRICING_USD_PER_MTOK` so callers only report
 * raw token counts. Callers are expected to fire-and-forget; this function
 * never throws for a bad row — it logs and returns null.
 */
export async function recordLlmUsage(
  input: LlmUsageCreateRequest,
  prisma: PrismaClient,
): Promise<LlmUsageCreateResponse | null> {
  try {
    const costUsd = estimateCostUsd(input.model, {
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      cacheReadTokens: input.cacheReadTokens,
      cacheWriteTokens: input.cacheWriteTokens,
    });
    const row = await prisma.llmUsage.create({
      data: {
        userId: input.userId ?? null,
        tenantId: input.tenantId ?? null,
        service: input.service,
        purpose: input.purpose,
        model: input.model,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        cacheReadTokens: input.cacheReadTokens ?? 0,
        cacheWriteTokens: input.cacheWriteTokens ?? 0,
        costUsd,
        durationMs: input.durationMs ?? null,
        sessionId: input.sessionId ?? null,
      },
      select: { id: true, costUsd: true },
    });
    return { id: row.id, costUsd: row.costUsd };
  } catch (err) {
    logger.warn('[llm-usage] failed to record usage row', {
      purpose: input.purpose,
      model: input.model,
      error: (err as Error).message,
    });
    return null;
  }
}

/** Minimal row shape the aggregator needs — keeps the pure function testable. */
export interface UsageRow {
  purpose: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  createdAt: Date;
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const utcDay = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Pure aggregation for GET /usage/llm/summary. `byDay` always contains one
 * entry per calendar day in the window (zero-filled, ascending) so the cost
 * widget can plot it without gaps. `byPurpose` / `byModel` are sorted by usd
 * descending.
 */
export function aggregateUsage(rows: UsageRow[], days: number, now: Date = new Date()): LlmUsageSummary {
  const dayMap = new Map<string, LlmUsageByDay>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const key = utcDay(d);
    dayMap.set(key, { date: key, usd: 0, calls: 0 });
  }

  const purposeMap = new Map<string, LlmUsageByPurpose & { _in: number; _read: number; _write: number }>();
  const modelMap = new Map<string, LlmUsageByModel>();
  let totalUsd = 0;

  for (const r of rows) {
    totalUsd += r.costUsd;

    const dayKey = utcDay(r.createdAt);
    const day = dayMap.get(dayKey);
    if (day) {
      day.usd += r.costUsd;
      day.calls += 1;
    }

    const p = purposeMap.get(r.purpose) ?? {
      purpose: r.purpose, usd: 0, calls: 0, cacheHitRate: 0, _in: 0, _read: 0, _write: 0,
    };
    p.usd += r.costUsd;
    p.calls += 1;
    p._in += r.inputTokens;
    p._read += r.cacheReadTokens;
    p._write += r.cacheWriteTokens;
    purposeMap.set(r.purpose, p);

    const m = modelMap.get(r.model) ?? { model: r.model, usd: 0, calls: 0, inputTokens: 0, outputTokens: 0 };
    m.usd += r.costUsd;
    m.calls += 1;
    m.inputTokens += r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens;
    m.outputTokens += r.outputTokens;
    modelMap.set(r.model, m);
  }

  const byPurpose: LlmUsageByPurpose[] = [...purposeMap.values()]
    .map(({ _in, _read, _write, ...rest }) => {
      const denom = _in + _read + _write;
      return { ...rest, usd: round6(rest.usd), cacheHitRate: denom > 0 ? round6(_read / denom) : 0 };
    })
    .sort((a, b) => b.usd - a.usd || a.purpose.localeCompare(b.purpose));

  const byModel: LlmUsageByModel[] = [...modelMap.values()]
    .map(m => ({ ...m, usd: round6(m.usd) }))
    .sort((a, b) => b.usd - a.usd || a.model.localeCompare(b.model));

  const byDay = [...dayMap.values()].map(d => ({ ...d, usd: round6(d.usd) }));

  return { days, totalUsd: round6(totalUsd), byDay, byPurpose, byModel };
}

export async function getUsageSummary(
  opts: { days: number; userId?: string | null },
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<LlmUsageSummary> {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (opts.days - 1)));
  const rows = await prisma.llmUsage.findMany({
    where: {
      createdAt: { gte: since },
      ...(opts.userId ? { userId: opts.userId } : {}),
    },
    select: {
      purpose: true, model: true, inputTokens: true, outputTokens: true,
      cacheReadTokens: true, cacheWriteTokens: true, costUsd: true, createdAt: true,
    },
  });
  return aggregateUsage(rows, opts.days, now);
}
