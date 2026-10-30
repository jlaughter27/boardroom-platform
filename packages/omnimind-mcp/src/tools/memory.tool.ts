import { createHash } from 'crypto';
import { z } from 'zod';
import {
  normalizeDomain,
  isMinistryDomain,
  isMinistryTenant,
  McpIdempotencyKeySchema,
  McpCursorSchema,
  McpMemoryWriteOutputSchema,
  McpMemorySearchOutputSchema,
  McpMemorySupersedeOutputSchema,
  McpMemoryReflectOutputSchema,
  McpMemoryConsolidateOutputSchema,
} from '@boardroom/shared';
import type { McpConsolidationPair } from '@boardroom/shared';
import { extractAndDedup } from '../lib/fact-extractor';
import { requireScope } from '../lib/namespace';
import { withAudit, auditRefusal, redactInputForAudit } from '../lib/audit';
import { parseInput } from '../lib/validate';
import { MAX_PAGE_SIZE } from '../lib/cursor';
import { LruTtlCache, replayCacheKey } from '../lib/replay-cache';
import { retryWithDelays, DEFERRED_EXTRACTION_RETRY_DELAYS_MS } from '../lib/deferred-work';
import { PROVENANCE, McpProvenanceSchema } from '../lib/provenance';
import type { OmniMindClient, MemoryRecord } from '../lib/client';
import {
  ADDITIVE_WRITE_ANNOTATIONS,
  DESTRUCTIVE_WRITE_ANNOTATIONS,
  IDEMPOTENT_WRITE_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
} from '../types';
import type { AgentContext, FactWithAction, McpTool, MemoryWriteResult, MemoryWriteSuccess } from '../types';

/** Shared schemas + the front-door additions (`provenance` on reads, `extraction` on writes). */
export const MemorySearchOutputSchema = McpMemorySearchOutputSchema.extend({ provenance: McpProvenanceSchema });
export const MemoryWriteOutputSchema = McpMemoryWriteOutputSchema.extend({ extraction: z.enum(['sync', 'async', 'deferred']).optional() });

/**
 * M1-B2 — appended to the extractor's error when sync-mode `memory_write`
 * stores the prose and defers extraction instead of refusing.
 */
export const EXTRACTION_DEFERRED_MESSAGE =
  'The memory was stored as written (one row) and fact extraction was deferred; it is retried in the background and the extracted facts then supersede this row. Do not repeat this call.';

/** True for the extractor-outage error (`FactExtractorUnavailableError`, matched by code so a mocked module still works). */
export function isFactExtractorUnavailable(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'FACT_EXTRACTOR_UNAVAILABLE';
}

/**
 * `OMNIMIND_MCP_WRITE_EXTRACT` — `sync` (default) runs Haiku fact extraction
 * inside the `memory_write` call; `async` stores the prose as one memory row,
 * returns its id immediately, and runs extraction after responding (the
 * extracted facts supersede the raw row). Flip to `async` when the `bench`
 * subcommand shows p95 above ~20 s — Claude Code backgrounds MCP calls past
 * two minutes and several clients time out at 60 s.
 */
export type WriteExtractMode = 'sync' | 'async';

export function resolveWriteExtractMode(env: NodeJS.ProcessEnv = process.env): WriteExtractMode {
  return env.OMNIMIND_MCP_WRITE_EXTRACT?.trim().toLowerCase() === 'async' ? 'async' : 'sync';
}

export interface MemoryWriteToolOptions {
  /** Defaults to `resolveWriteExtractMode(process.env)`. */
  extractMode?: WriteExtractMode;
  /**
   * M-2 — client the deferred extraction runs on in `async` mode. Over the HTTP
   * front door this is a second client bound to the same principal that
   * outlives the session (owned by the app's `DeferredWorkQueue`), so a DELETE
   * / idle sweep / eviction racing the 2-5 s Haiku call no longer loses the
   * facts and the `memory_write:extract` audit row. Defaults to `client`.
   */
  deferredClient?: OmniMindClient;
  /** Receives the deferred-extraction promise in `async` mode, and in `sync` mode when extraction was deferred (already error-handled): the HTTP app tracks it for drain-on-shutdown; tests await it. */
  onDeferred?: (done: Promise<void>) => void;
  /** M1-B2 — waits before each background extraction attempt after a sync-mode extractor failure. Defaults to `DEFERRED_EXTRACTION_RETRY_DELAYS_MS`. */
  deferredRetryDelaysMs?: readonly number[];
  /** Injectable sleep for those waits (tests). */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Normalize domain so refusal gates (ministry) cannot be bypassed by case or
 * whitespace. WS-6 F-101. Uses the shared `normalizeDomain` so the MCP-side
 * gate, the API-side gate and audit redaction all agree.
 */
export const DomainSchema = z
  .string()
  .min(1)
  .transform(s => normalizeDomain(s))
  .refine(s => s.length > 0, { message: 'domain cannot be empty after trim' });

/**
 * H2 (2026-10-30) — true when this session's tenant (the token's tenant on the
 * hosted gateway, `OMNIMIND_MCP_TENANT_ID` for stdio) is the ministry tenant
 * (`OMNIMIND_MINISTRY_TENANT_ID`, default `tgfc-ministry`). Every write there is
 * a ministry write whatever its `domain`, so it hits the MINISTRY_DEFERRED gate.
 */
export function isMinistryTenantCtx(ctx: Pick<AgentContext, 'tenantId'>, env: NodeJS.ProcessEnv = process.env): boolean {
  return isMinistryTenant(ctx.tenantId, env.OMNIMIND_MINISTRY_TENANT_ID?.trim() || undefined);
}

/**
 * H2 — the domain a write lands in: always `'ministry'` in the ministry tenant
 * (so the gate applies and audit redaction kicks in), else the caller's
 * normalized domain, else `fallback`.
 */
export function effectiveWriteDomain(ctx: Pick<AgentContext, 'tenantId'>, domain: string | undefined, fallback: string): string {
  if (isMinistryTenantCtx(ctx)) return 'ministry';
  return domain ?? fallback;
}

export const MINISTRY_DEFERRED_MESSAGE =
  'Ministry-domain memories are deferred. Use a non-ministry domain. Ministry path will return in Phase 6+.';

/** Phase 6 — optional `Idempotency-Key` for the write tools (≤100 chars; see MCP_IDEMPOTENCY_KEY_MAX_LENGTH). */
export const IdempotencyKeyInput = McpIdempotencyKeySchema.optional().describe(
  'Optional idempotency key (≤100 chars). Repeating a call with the same key within 24h replays the first result instead of writing again.'
);

/** Length of the user-key prefix kept readable at the front of a derived per-fact key. */
export const FACT_KEY_PREFIX_LENGTH = 32;

/**
 * R-M-03 — per-extracted-fact `Idempotency-Key`. The old `${key}:${i}`.slice(0,128)
 * collided once the user key approached the cap (every fact truncated to the
 * same string). Now: `<first 32 chars of the user key>:<sha256(key + ':' + factText) hex, 64 chars>`
 * — ≤ 97 chars (under OmniMind's 128 limit), unique per distinct fact text,
 * and stable across retries so the server replays the same N rows.
 */
export function deriveFactIdempotencyKey(userKey: string, factText: string): string {
  const digest = createHash('sha256').update(`${userKey}:${factText}`).digest('hex').slice(0, 64);
  return `${userKey.slice(0, FACT_KEY_PREFIX_LENGTH)}:${digest}`;
}

/**
 * L-8 — `Idempotency-Key` for the async tail's `PATCH … { supersedes: raw }`.
 * Derived from the raw row id alone so a replay after a process restart (the
 * in-memory replay cache is empty, the row writes replay via their own keys)
 * does not apply the supersede twice. 75 chars, under OmniMind's 128 cap.
 */
export function deriveSupersedeIdempotencyKey(rawId: string): string {
  return `supersedes:${createHash('sha256').update(`supersedes:${rawId}`).digest('hex')}`;
}

/**
 * R-M-03 — process-local replay cache for the whole `memory_write` result
 * (≤500 entries, 24 h), keyed by (agentId, userId, idempotencyKey). A retry
 * with the same key returns the cached result without re-running extraction.
 */
export const memoryWriteReplayCache = new LruTtlCache<MemoryWriteSuccess>();

/** Cosine threshold above which two memories are treated as duplicates by memory_consolidate. */
export const CONSOLIDATE_SIMILARITY_THRESHOLD = 0.92;
export const CONSOLIDATE_MAX_LIMIT = 50;

const MemoryWriteInput = z.object({
  content: z.string().min(1).max(10000).describe('The memory content to store'),
  domain: DomainSchema.optional().describe('Domain context: business, personal, ministry, technical. Defaults to general (ministry in the ministry tenant, where writes are deferred).'),
  tags: z.array(z.string()).default([]).describe('Tags for retrieval'),
  importance: z.number().min(0).max(1).default(0.5).describe('Importance score 0-1'),
  userId: z.string().describe('The user ID this memory belongs to'),
  skipExtraction: z.boolean().default(false).describe('Skip fact extraction and store as-is'),
  idempotencyKey: IdempotencyKeyInput,
});

const MemorySearchInput = z.object({
  query: z.string().min(1).describe('Natural-language query — hybrid semantic + full-text + trigram search with recency weighting'),
  userId: z.string().describe('User ID to search memories for'),
  domain: DomainSchema.optional().describe('Narrow to a specific domain'),
  tags: z.array(z.string()).optional().describe('Only memories carrying ALL of these tags'),
  status: z.enum(['DRAFT', 'CONFIRMED', 'SUPERSEDED', 'ARCHIVED', 'REJECTED']).optional()
    .describe('Exact memory status. When omitted, archived memories are excluded.'),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(5).describe('Page size (max 20)'),
  includeArchived: z.boolean().default(false).describe('Include ARCHIVED memories in the ranking'),
  asOf: z.string().datetime({ offset: true }).optional()
    .describe('ISO timestamp — only return facts that were valid at this moment (temporal validity filter)'),
  cursor: McpCursorSchema.optional().describe('Opaque cursor from a previous page (`nextCursor`)'),
});

const MemorySupersededInput = z.object({
  id: z.string().describe('Memory ID to supersede'),
  newContent: z.string().min(1).describe('Updated content'),
  userId: z.string().describe('User ID'),
});

const MemoryReflectInput = z.object({
  entityType: z.enum(['goal', 'project', 'person']).describe('Entity kind to reflect on'),
  entityId: z.string().min(1).describe('Entity id (Goal / Project / Person primary key)'),
  userId: z.string().describe('User ID'),
});

const MemoryConsolidateInput = z.object({
  userId: z.string().describe('User ID'),
  dryRun: z.boolean().default(true).describe('true (default) = only propose pairs; false = apply PATCH supersedes for each pair'),
  limit: z.number().int().min(1).max(CONSOLIDATE_MAX_LIMIT).default(20).describe('How many recent memories to scan (max 50)'),
  domain: DomainSchema.optional().describe('Restrict the scan to one domain'),
});

function refused(error: 'MINISTRY_DEFERRED' | 'FACT_EXTRACTOR_UNAVAILABLE', message: string): MemoryWriteResult {
  return { ok: false, error, message, created: [], updated: [], skipped: 0 };
}

type MemoryWriteParsedInput = Omit<z.infer<typeof MemoryWriteInput>, 'domain'> & { domain: string };

interface FactWriteTally {
  created: string[];
  updated: string[];
  skipped: number;
}

/**
 * Write extracted facts: `create` → `POST /memories` (a near-duplicate is
 * auto-superseded server-side and reported as `updated`, M-107); `update` →
 * explicit `PATCH /memories/:supersedes` (`supersedes` is NOT accepted on POST).
 * One idempotency key covers the whole call; each fact gets a derived key so a
 * replay returns the same N rows, not one.
 */
async function writeFacts(client: OmniMindClient, ctx: AgentContext, input: MemoryWriteParsedInput, facts: FactWithAction[]): Promise<FactWriteTally> {
  const tally: FactWriteTally = { created: [], updated: [], skipped: 0 };
  const factOpts = (factText: string) =>
    input.idempotencyKey ? { idempotencyKey: deriveFactIdempotencyKey(input.idempotencyKey, factText) } : undefined;
  for (const fact of facts) {
    if (fact.action === 'create') {
      const r = await client.createMemory({
        title: fact.text.slice(0, 80),
        content: fact.text,
        domain: input.domain,
        tags: [...input.tags, fact.type],
        importance: input.importance,
        sourceType: 'MCP_AGENT',
        agentId: ctx.agentId,
        tenantId: ctx.tenantId,
        sourceWeight: ctx.sourceWeight,
      }, input.userId, factOpts(fact.text));
      (r.status === 'updated' ? tally.updated : tally.created).push(r.id);
    } else if (fact.action === 'update' && fact.supersedes) {
      const mem = await client.updateMemory(fact.supersedes, {
        content: fact.text,
        sourceType: 'MCP_AGENT',
        agentId: ctx.agentId,
      }, input.userId, factOpts(fact.text));
      tally.updated.push(mem.id);
    } else {
      tally.skipped++;
    }
  }
  return tally;
}

export function memoryWriteTool(client: OmniMindClient, ctx: AgentContext, opts: MemoryWriteToolOptions = {}) {
  const extractMode = opts.extractMode ?? resolveWriteExtractMode();
  return {
    name: 'memory_write',
    title: 'Write memory',
    description: 'Write one or more memories to the shared store. Fact extraction and dedup runs automatically — duplicate facts are updated, not duplicated. If extraction is unavailable the memory is still stored and extraction is retried in the background (`extraction: "deferred"`); do not repeat the call. Pass idempotencyKey to make retries safe.',
    inputSchema: MemoryWriteInput,
    outputSchema: MemoryWriteOutputSchema,
    annotations: ADDITIVE_WRITE_ANNOTATIONS,
    async execute(raw: unknown): Promise<MemoryWriteResult> {
      requireScope(ctx, 'memory:write');
      const parsed = parseInput(MemoryWriteInput, raw);
      // H2: no silent 'general' default in the ministry tenant — the effective
      // domain there is 'ministry', so the refusal below applies.
      const input: MemoryWriteParsedInput = { ...parsed, domain: effectiveWriteDomain(ctx, parsed.domain, 'general') };
      const writeOpts = input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined;

      // Ministry domain is explicitly deferred (Phase 6+). F-212: the refusal
      // is audited (redacted) instead of vanishing.
      if (isMinistryDomain(input.domain)) {
        auditRefusal(client, ctx, 'memory_write', input, 'MINISTRY_DEFERRED');
        return refused('MINISTRY_DEFERRED', MINISTRY_DEFERRED_MESSAGE);
      }

      const auditInput = redactInputForAudit(input);

      const replayKey = input.idempotencyKey
        ? replayCacheKey(ctx.agentId, input.userId, input.idempotencyKey)
        : undefined;
      if (replayKey) {
        const replayed = memoryWriteReplayCache.get(replayKey);
        if (replayed) {
          // Same (agent, user, key) within 24 h: hand back the first result and
          // skip extraction + API writes entirely. Still audited.
          return withAudit(client, ctx, 'memory_write', auditInput, async () => replayed);
        }
      }

      /** The prose as one memory row (skipExtraction, no facts extracted, or the async raw row). */
      const createRawRow = () => client.createMemory({
        title: input.content.slice(0, 80),
        content: input.content,
        domain: input.domain,
        tags: input.tags,
        importance: input.importance,
        sourceType: 'MCP_AGENT',
        agentId: ctx.agentId,
        tenantId: ctx.tenantId,
        sourceWeight: ctx.sourceWeight,
      }, input.userId, writeOpts);

      // M-107: report the server's verdict — a near-duplicate is auto-superseded
      // server-side and comes back as status 'updated', not 'created'.
      const tallyOf = (r: { id: string; status: 'created' | 'updated' }): FactWriteTally =>
        r.status === 'updated' ? { created: [], updated: [r.id], skipped: 0 } : { created: [r.id], updated: [], skipped: 0 };

      if (!input.skipExtraction && extractMode === 'async') {
        // Async mode: respond as soon as the raw row exists; extract afterwards.
        const result = await withAudit(client, ctx, 'memory_write', auditInput, async (): Promise<MemoryWriteSuccess> => {
          const raw = await createRawRow();
          return { ok: true, ...tallyOf(raw), extraction: 'async' };
        });
        if (replayKey) memoryWriteReplayCache.set(replayKey, result);
        const rawId = result.created[0] ?? result.updated[0];
        const deferred = runDeferredExtraction(opts.deferredClient ?? client, ctx, input, auditInput, rawId);
        opts.onDeferred?.(deferred);
        return result;
      }

      const result = await withAudit(client, ctx, 'memory_write', auditInput, async (): Promise<MemoryWriteSuccess> => {
        if (input.skipExtraction) return { ok: true, ...tallyOf(await createRawRow()) };

        let facts: FactWithAction[];
        try {
          facts = await extractAndDedup(input.content, ctx, client, input.userId);
        } catch (err) {
          if (!isFactExtractorUnavailable(err)) throw err;
          // M1-B2 — the extractor is down (no key, rate limit, timeout). It
          // wrote nothing, so store the prose as one row through POST /memories
          // (validation pipeline + the caller's Idempotency-Key, so a retry
          // replays this same row) and retry extraction in the background.
          // Refusing here made agents drop the memory or retry into the outage.
          return {
            ok: true,
            ...tallyOf(await createRawRow()),
            extraction: 'deferred',
            message: `${(err as Error).message} ${EXTRACTION_DEFERRED_MESSAGE}`,
          };
        }
        // No facts extracted → store raw content as a single context memory
        if (facts.length === 0) return { ok: true, ...tallyOf(await createRawRow()) };

        return { ok: true, ...(await writeFacts(client, ctx, input, facts)) };
      });
      // The deferred result is cached like any success: a retry with the same
      // key replays it instead of writing (or scheduling extraction) again.
      if (replayKey) memoryWriteReplayCache.set(replayKey, result);
      if (result.extraction === 'deferred') {
        const rawId = result.created[0] ?? result.updated[0];
        console.warn(`[memory_write] fact extraction unavailable; raw row ${rawId ?? '(unknown)'} stored, extraction deferred`);
        const deferred = runDeferredExtraction(opts.deferredClient ?? client, ctx, input, auditInput, rawId, {
          retryDelaysMs: opts.deferredRetryDelaysMs ?? DEFERRED_EXTRACTION_RETRY_DELAYS_MS,
          ...(opts.sleep ? { sleep: opts.sleep } : {}),
        });
        opts.onDeferred?.(deferred);
      }
      return result;
    },
  } satisfies McpTool;
}

/** What the `memory_write:extract` audit row says happened to the raw prose row. */
export const RAW_ROW_KEPT_NO_FACTS = 'no facts extracted; raw row kept';
export const RAW_ROW_KEPT_UPDATES_ONLY = 'facts updated existing rows only (no new fact row to supersede it); raw row kept';

/**
 * Background tail of `memory_write` (async mode; and sync mode after an
 * extractor outage, M1-B2, with `retry`): extract facts from the prose that was
 * already stored as `rawId`, write them, and — when at least one new fact row
 * was created — supersede the raw row with the first one (the prose survives
 * in version history / `consolidatedFrom`; nothing is deleted). When every
 * fact was an *update* of an existing row there is nothing to supersede it
 * with, so the raw row is kept and the audit row says so (`rawRowKept`,
 * `reason`). Audited as `memory_write:extract`; failures are logged, never
 * thrown (the caller has already received its response).
 */
export interface DeferredExtractionRetry {
  /** One extraction attempt per entry, each after waiting that many ms; only extractor outages are retried. */
  retryDelaysMs: readonly number[];
  sleep?: (ms: number) => Promise<void>;
}

export function runDeferredExtraction(
  client: OmniMindClient,
  ctx: AgentContext,
  input: MemoryWriteParsedInput,
  auditInput: unknown,
  rawId: string | undefined,
  retry?: DeferredExtractionRetry
): Promise<void> {
  const extract = () => extractAndDedup(input.content, ctx, client, input.userId);
  return withAudit(client, ctx, 'memory_write:extract', auditInput, async () => {
    // M1-B2: after a sync-mode outage, wait before each attempt (the async
    // mode's first attempt runs at once — there is no outage to wait out).
    const facts = retry && retry.retryDelaysMs.length > 0
      ? await retryWithDelays(extract, { delaysMs: retry.retryDelaysMs, retryIf: isFactExtractorUnavailable, ...(retry.sleep ? { sleep: retry.sleep } : {}) })
      : await extract();
    if (facts.length === 0) return { ok: true, created: [], updated: [], skipped: 0, rawId, rawRowKept: true, reason: RAW_ROW_KEPT_NO_FACTS };
    const tally = await writeFacts(client, ctx, input, facts);
    if (rawId && tally.created.length > 0 && !tally.created.includes(rawId)) {
      await client.updateMemory(
        tally.created[0],
        { supersedes: rawId, agentId: ctx.agentId },
        input.userId,
        { idempotencyKey: deriveSupersedeIdempotencyKey(rawId) }
      );
      return { ok: true, ...tally, rawId, rawRowKept: false };
    }
    return { ok: true, ...tally, rawId, rawRowKept: true, ...(tally.updated.length > 0 && tally.created.length === 0 ? { reason: RAW_ROW_KEPT_UPDATES_ONLY } : {}) };
  })
    .then(() => undefined)
    .catch(err => {
      console.error(`[memory_write] deferred extraction failed${rawId ? ` (raw row ${rawId} kept)` : ''}:`, (err as Error).message);
    });
}

export function memorySearchTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'memory_search',
    title: 'Search memories',
    description: 'Hybrid search over the shared memory store (semantic + full-text + trigram, recency-weighted). Paginated: pass `cursor` from `nextCursor` for the next page (max 20 per page).',
    inputSchema: MemorySearchInput,
    outputSchema: MemorySearchOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
    async execute(raw: unknown) {
      requireScope(ctx, 'memory:read');
      const input = parseInput(MemorySearchInput, raw);

      return withAudit(client, ctx, 'memory_search', input, async () => {
        const { items, nextCursor } = await client.searchHybrid({
          query: input.query,
          limit: input.limit,
          domain: input.domain,
          tags: input.tags,
          status: input.status,
          includeArchived: input.includeArchived,
          asOf: input.asOf,
          cursor: input.cursor,
        }, input.userId);
        return { memories: items, count: items.length, nextCursor, provenance: PROVENANCE };
      });
    },
  } satisfies McpTool;
}

export function memorySupersedeT(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'memory_supersede',
    title: 'Supersede memory',
    description: 'Mark an existing memory as outdated and replace its content. The old content is kept in version history, not deleted.',
    inputSchema: MemorySupersededInput,
    outputSchema: McpMemorySupersedeOutputSchema,
    annotations: DESTRUCTIVE_WRITE_ANNOTATIONS,
    async execute(raw: unknown) {
      requireScope(ctx, 'memory:write');
      const input = parseInput(MemorySupersededInput, raw);

      // Check domain of the existing memory to decide whether to redact
      let auditInput: Record<string, unknown> = input as Record<string, unknown>;
      try {
        const existing = await client.getMemory(input.id, input.userId);
        if (existing && isMinistryDomain(existing.domain)) {
          auditInput = { ...auditInput, domain: 'ministry', newContent: '[REDACTED:ministry]' };
        }
      } catch {
        // If lookup fails, log as-is (fail open on audit redaction)
      }

      return withAudit(client, ctx, 'memory_supersede', auditInput, async () => {
        const mem = await client.updateMemory(input.id, {
          content: input.newContent,
          sourceType: 'MCP_AGENT',
          agentId: ctx.agentId,
        }, input.userId);
        return { id: mem.id, updated: true as const };
      });
    },
  } satisfies McpTool;
}

/**
 * Phase 6 — `memory_reflect`: regenerate one entity's ContextCapsule right now
 * (`POST /context/reflect`, Haiku, Zod-validated server-side) and return it.
 * Idempotent in effect: reflecting twice yields the same capsule (version++).
 */
export function memoryReflectTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'memory_reflect',
    title: 'Reflect on entity',
    description: 'Regenerate the context capsule (summary, open risks, unresolved questions, recent changes, stakeholders) for one goal, project or person from its linked memories, and return it.',
    inputSchema: MemoryReflectInput,
    outputSchema: McpMemoryReflectOutputSchema,
    annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    async execute(raw: unknown) {
      requireScope(ctx, 'memory:write');
      const input = parseInput(MemoryReflectInput, raw);

      return withAudit(client, ctx, 'memory_reflect', input, async () => {
        const capsule = await client.reflect({ entityType: input.entityType, entityId: input.entityId }, input.userId);
        return { entityType: input.entityType, entityId: input.entityId, capsule };
      });
    },
  } satisfies McpTool;
}

type ConsolidationCandidate = Pick<MemoryRecord, 'id' | 'importance' | 'createdAt'> &
  Partial<Pick<MemoryRecord, 'status' | 'invalidAt' | 'supersededBy'>>;

/**
 * R-M-01 — a row that has already been superseded (temporal `invalidAt` /
 * `supersededBy` set, or a terminal status) must never be re-proposed: the
 * old code re-listed it with status still CONFIRMED and a later pass could
 * flip the pair back. Exported for tests.
 */
export function isInvalidatedMemory(m: Partial<Pick<MemoryRecord, 'status' | 'invalidAt' | 'supersededBy'>>): boolean {
  if (m.invalidAt) return true;
  if (m.supersededBy) return true;
  return m.status === 'SUPERSEDED' || m.status === 'ARCHIVED';
}

/** keep = the row that is still valid; then higher importance; tie → newer `createdAt`. Exported for tests. */
export function chooseKeep(a: ConsolidationCandidate, b: ConsolidationCandidate): { keepId: string; archiveId: string } {
  const invA = isInvalidatedMemory(a);
  const invB = isInvalidatedMemory(b);
  if (invA !== invB) return invA ? { keepId: b.id, archiveId: a.id } : { keepId: a.id, archiveId: b.id };
  const ia = a.importance ?? 0;
  const ib = b.importance ?? 0;
  if (ia !== ib) return ia > ib ? { keepId: a.id, archiveId: b.id } : { keepId: b.id, archiveId: a.id };
  const ta = Date.parse(a.createdAt ?? '') || 0;
  const tb = Date.parse(b.createdAt ?? '') || 0;
  return ta >= tb ? { keepId: a.id, archiveId: b.id } : { keepId: b.id, archiveId: a.id };
}

/**
 * Phase 6 — `memory_consolidate`: "dream" pass over the tenant's recent
 * memories. For each one, `POST /memories/search-similar` at ≥0.92 proposes
 * `{keepId, archiveId, similarity}`; with `dryRun=false` each pair is applied
 * as `PATCH /memories/:keepId { supersedes: archiveId }` (old row gets
 * `invalidAt`/`supersededBy`, nothing is deleted). Destructive only when
 * `dryRun=false`; the annotation reflects the worst case.
 */
export function memoryConsolidateTool(client: OmniMindClient, ctx: AgentContext) {
  return {
    name: 'memory_consolidate',
    title: 'Consolidate duplicate memories',
    description: 'Find near-duplicate memories (cosine ≥ 0.92) among the most recent ones and propose keep/archive pairs. Default dryRun=true only proposes; dryRun=false supersedes each archiveId with its keepId (reversible via version history, never deleted).',
    inputSchema: MemoryConsolidateInput,
    outputSchema: McpMemoryConsolidateOutputSchema,
    annotations: DESTRUCTIVE_WRITE_ANNOTATIONS,
    async execute(raw: unknown) {
      requireScope(ctx, 'memory:write');
      const input = parseInput(MemoryConsolidateInput, raw);

      return withAudit(client, ctx, 'memory_consolidate', input, async () => {
        const recent = await client.searchMemories({
          tenantId: ctx.tenantId,
          userId: input.userId,
          limit: input.limit,
          domain: input.domain,
          sortBy: 'createdAt',
          sortOrder: 'desc',
        });
        // Ministry rows are never touched: their content is encrypted and their
        // embeddings live on the local model; consolidation is OpenAI-side only.
        // Already-superseded rows (R-M-01) are excluded from the scan AND from
        // the candidate hits below, so a pair never involves an invalidated row.
        const untouchable = (m: MemoryRecord) => isMinistryDomain(m.domain) || isInvalidatedMemory(m);
        const scannable = recent.filter(m => !untouchable(m));
        const excluded = new Set(recent.filter(untouchable).map(m => m.id));
        const byId = new Map(scannable.map(m => [m.id, m]));

        const pairs: McpConsolidationPair[] = [];
        const seen = new Set<string>();
        const archived = new Set<string>();
        const keepers = new Set<string>();

        for (const mem of scannable) {
          if (archived.has(mem.id) || !mem.content?.trim()) continue;
          let hits: Awaited<ReturnType<OmniMindClient['searchSimilar']>> = [];
          try {
            hits = await client.searchSimilar({
              query: mem.content,
              userId: input.userId,
              threshold: CONSOLIDATE_SIMILARITY_THRESHOLD,
              limit: 5,
              domain: mem.domain,
            });
          } catch {
            continue; // one failed similarity lookup must not abort the whole pass
          }
          for (const hit of hits) {
            // R-M-02: once `mem` has been archived under one keeper in this
            // pass, no further hit may archive it again (or keep it).
            if (archived.has(mem.id)) break;
            if (hit.id === mem.id || hit.similarity < CONSOLIDATE_SIMILARITY_THRESHOLD) continue;
            if (isMinistryDomain(hit.domain) || excluded.has(hit.id) || isInvalidatedMemory(hit)) continue;
            const key = [mem.id, hit.id].sort().join('|');
            if (seen.has(key)) continue;
            seen.add(key);
            const other = byId.get(hit.id) ?? hit;
            if (archived.has(other.id) || isInvalidatedMemory(other)) continue;
            const { keepId, archiveId } = chooseKeep(mem, other);
            // Never archive a row that is already acting as a keeper, and never
            // keep a row that is already being archived (conflicting direction).
            if (archived.has(keepId) || keepers.has(archiveId)) continue;
            archived.add(archiveId);
            keepers.add(keepId);
            pairs.push({ keepId, archiveId, similarity: Math.min(1, Math.max(0, hit.similarity)) });
          }
        }

        let applied = 0;
        const errors: Array<{ keepId: string; archiveId: string; message: string }> = [];
        if (!input.dryRun) {
          for (const pair of pairs) {
            try {
              await client.updateMemory(pair.keepId, { supersedes: pair.archiveId, agentId: ctx.agentId }, input.userId);
              applied++;
            } catch (err) {
              errors.push({ keepId: pair.keepId, archiveId: pair.archiveId, message: (err as Error).message });
            }
          }
        }

        return { dryRun: input.dryRun, scanned: scannable.length, pairs, applied, errors };
      });
    },
  } satisfies McpTool;
}
