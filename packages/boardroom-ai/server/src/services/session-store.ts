// RD-17 — Decision Lab session store: in-memory cache, written through to
// OmniMind (`/decision-sessions`), loaded from OmniMind on a cache miss.
//
//  - create: OmniMind assigns the id (cuid). OmniMind unreachable → a local id
//    (`session_<n>_<ms>`) and the session lives in memory only (pre-RD-17
//    behaviour); never fatal.
//  - persist: coalesced per session (`debounceMs`) and serialized (one write in
//    flight per session); `flush` writes now (decision commit). A failed write
//    is logged, never thrown — the session keeps working from memory.
//  - get: cache hit → owner check; miss → `GET /decision-sessions/:id` (scoped
//    to the user by OmniMind). Non-cuid ids never reach OmniMind. 404 → null;
//    any other OmniMind failure propagates.
//  - sweep: evicts idle sessions from the cache (flushing pending writes
//    first); a persisted session is reloaded on its next request.

import { DecisionSessionStatus } from '@boardroom/shared';
import type { UserMode } from '@boardroom/shared';
import type { SessionState } from '../agents/orchestrator';
import type { OmniMindClient } from './omnimind-client';
import { fromRecord, toPersistPayload } from './session-snapshot';
import { logger } from '../lib/logger';

export interface StoredSession extends SessionState {
  createdAt: number;
  lastActivityAt: number;
  /**
   * R-B-06: set SYNCHRONOUSLY before the first `await` in POST /:id/decide so a
   * concurrent second commit is rejected while the first is still in flight
   * (`decisionId` is only known after OmniMind answers). Cleared on failure.
   * Never persisted.
   */
  decisionPending?: boolean;
}

export interface SessionSummary {
  id: string;
  question: string;
  mode: UserMode;
  personaCount: number;
  hasSynthesis: boolean;
  createdAt: string;
}

export type SessionStoreClient = Pick<
  OmniMindClient,
  'createDecisionSession' | 'getDecisionSession' | 'listDecisionSessions' | 'updateDecisionSession'
>;

export interface SessionStoreOptions {
  /** Coalescing window for write-through (default 500 ms). */
  debounceMs?: number;
  /** Cache idle TTL (default 30 min, B-119: since the LAST activity). */
  idleTtlMs?: number;
  /** Cache capacity for new sessions (default 10 000). */
  maxSessions?: number;
  /** Called when a session leaves the cache (e.g. release its tool budget). */
  onEvict?: (id: string) => void;
}

/** OmniMind ids are cuids; anything else (pre-RD-17 / local ids) is memory-only. */
const PERSISTABLE_ID = /^c[a-z0-9]{20,32}$/;

export class SessionCapacityError extends Error {
  constructor() { super('Too many active sessions'); this.name = 'SessionCapacityError'; }
}

function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown })?.status;
  return typeof s === 'number' ? s : undefined;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function summarize(s: SessionState & { createdAt: number }): SessionSummary {
  return {
    id: s.id,
    question: s.question,
    mode: s.mode,
    personaCount: s.personaResponses.size,
    hasSynthesis: s.synthesis !== null,
    createdAt: new Date(s.createdAt).toISOString(),
  };
}

export class DecisionSessionStore {
  private readonly cache = new Map<string, StoredSession>();
  private readonly loading = new Map<string, Promise<StoredSession | null>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pending = new Map<string, StoredSession>();
  private readonly inflight = new Map<string, Promise<void>>();
  private localCounter = 0;
  private readonly debounceMs: number;
  private readonly idleTtlMs: number;
  private readonly maxSessions: number;

  constructor(private readonly omnimind: SessionStoreClient, private readonly options: SessionStoreOptions = {}) {
    this.debounceMs = options.debounceMs ?? 500;
    this.idleTtlMs = options.idleTtlMs ?? 30 * 60 * 1000;
    this.maxSessions = options.maxSessions ?? 10_000;
  }

  get size(): number {
    return this.cache.size;
  }

  /** Cached session (no OmniMind call, no owner check) — for touch-only paths. */
  peek(id: string): StoredSession | undefined {
    return this.cache.get(id);
  }

  async create(userId: string, input: { question: string; mode: UserMode; asOf?: string }): Promise<StoredSession> {
    if (this.cache.size >= this.maxSessions) throw new SessionCapacityError();
    const now = Date.now();
    const draft: StoredSession = {
      id: '',
      userId,
      question: input.question,
      mode: input.mode,
      personaResponses: new Map(),
      synthesis: null,
      createdAt: now,
      lastActivityAt: now,
      ...(input.asOf ? { asOf: input.asOf } : {}),
    };
    try {
      const payload = toPersistPayload(draft);
      const record = await this.omnimind.createDecisionSession(userId, {
        ...payload,
        status: DecisionSessionStatus.OPEN,
      });
      draft.id = record.id;
      draft.persisted = true;
      const created = Date.parse(record.createdAt);
      if (Number.isFinite(created)) draft.createdAt = created;
    } catch (err) {
      draft.id = `session_${++this.localCounter}_${now}`;
      draft.persisted = false;
      logger.warn('[SessionStore] persist failed', {
        op: 'create', sessionId: draft.id, userId, status: statusOf(err), message: errMessage(err),
      });
    }
    this.cache.set(draft.id, draft);
    return draft;
  }

  /** The user's session, from the cache or OmniMind; null when it does not exist for this user. */
  async get(id: string, userId: string): Promise<StoredSession | null> {
    const cached = this.cache.get(id);
    if (cached) {
      if (cached.userId !== userId) return null;
      cached.lastActivityAt = Date.now();
      return cached;
    }
    if (!PERSISTABLE_ID.test(id)) return null;

    const key = `${userId}\u0000${id}`;
    let load = this.loading.get(key);
    if (!load) {
      load = this.load(id, userId).finally(() => this.loading.delete(key));
      this.loading.set(key, load);
    }
    return load;
  }

  private async load(id: string, userId: string): Promise<StoredSession | null> {
    let record;
    try {
      record = await this.omnimind.getDecisionSession(userId, id);
    } catch (err) {
      if (statusOf(err) === 404) return null;
      throw err;
    }
    // Another request may have created / loaded it meanwhile: the cached object wins.
    const raced = this.cache.get(id);
    if (raced) return raced.userId === userId ? raced : null;

    const { session, dropped } = fromRecord(record);
    if (session.userId !== userId) return null; // defence in depth — OmniMind scopes by user
    if (dropped.length > 0) {
      logger.warn('[SessionStore] dropped invalid snapshot entries on load', { sessionId: id, dropped });
    }
    const stored: StoredSession = { ...session, lastActivityAt: Date.now() };
    this.cache.set(id, stored);
    logger.info('[SessionStore] session loaded from OmniMind', { sessionId: id, personaCount: stored.personaResponses.size });
    return stored;
  }

  /** Coalesced write-through after a meaningful transition. No-op for memory-only sessions. */
  schedulePersist(session: StoredSession): void {
    if (!session.persisted) return;
    this.pending.set(session.id, session);
    const existing = this.timers.get(session.id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => { void this.flush(session.id); }, this.debounceMs);
    (timer as { unref?: () => void }).unref?.();
    this.timers.set(session.id, timer);
  }

  /** Write the session now (after any write already in flight). Never throws. */
  async persistNow(session: StoredSession): Promise<void> {
    if (!session.persisted) return;
    this.pending.set(session.id, session);
    await this.flush(session.id);
  }

  /** Flush a pending write for `id` (serialized per session). Never throws. */
  async flush(id: string): Promise<void> {
    const timer = this.timers.get(id);
    if (timer) { clearTimeout(timer); this.timers.delete(id); }
    while (this.inflight.has(id)) await this.inflight.get(id);
    const session = this.pending.get(id);
    if (!session) return;
    this.pending.delete(id);
    const write = this.write(session).finally(() => this.inflight.delete(id));
    this.inflight.set(id, write);
    await write;
  }

  /** Flush every pending write (shutdown, tests). */
  async flushAll(): Promise<void> {
    await Promise.all(Array.from(new Set([...this.pending.keys(), ...this.inflight.keys()])).map((id) => this.flush(id)));
  }

  private async write(session: StoredSession): Promise<void> {
    try {
      await this.omnimind.updateDecisionSession(session.userId, session.id, toPersistPayload(session));
    } catch (err) {
      logger.warn('[SessionStore] persist failed', {
        op: 'update', sessionId: session.id, userId: session.userId, status: statusOf(err), message: errMessage(err),
      });
    }
  }

  /** Newest first; OmniMind's page plus (on page 1) the user's memory-only sessions. */
  async list(userId: string, limit: number, offset: number): Promise<{ items: SessionSummary[]; total: number; offset: number; limit: number }> {
    const mine = Array.from(this.cache.values()).filter((s) => s.userId === userId);
    const local = mine.filter((s) => !s.persisted).sort((a, b) => b.createdAt - a.createdAt);
    try {
      const page = await this.omnimind.listDecisionSessions(userId, { limit, offset });
      const remote = page.items.map((item): SessionSummary => {
        // The cache can be ahead of OmniMind (a coalesced write still pending).
        const cached = this.cache.get(item.id);
        if (cached && cached.userId === userId) return summarize(cached);
        return {
          id: item.id,
          question: item.question,
          mode: (item.mode ?? 'decide') as UserMode,
          personaCount: item.personaCount,
          hasSynthesis: item.hasSynthesis,
          createdAt: item.createdAt,
        };
      });
      const items = offset === 0 ? [...local.map(summarize), ...remote] : remote;
      return { items, total: page.total + local.length, offset, limit };
    } catch (err) {
      logger.warn('[SessionStore] list from OmniMind failed — serving cached sessions', {
        userId, status: statusOf(err), message: errMessage(err),
      });
      const all = mine.sort((a, b) => b.createdAt - a.createdAt);
      return { items: all.slice(offset, offset + limit).map(summarize), total: all.length, offset, limit };
    }
  }

  /** Evict idle sessions from the cache (pending writes are flushed first). */
  async sweep(now: number = Date.now()): Promise<number> {
    let evicted = 0;
    for (const [id, session] of Array.from(this.cache.entries())) {
      if (now - session.lastActivityAt <= this.idleTtlMs) continue;
      if (this.pending.has(id) || this.inflight.has(id)) await this.flush(id);
      // Touched while flushing (lastActivityAt moved past `now`) → keep it.
      if (now - session.lastActivityAt <= this.idleTtlMs) continue;
      this.cache.delete(id);
      this.options.onEvict?.(id);
      evicted++;
    }
    return evicted;
  }

  /** Drop the whole cache (tests: simulates a BoardRoom restart without persistence loss). */
  clearCache(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
    this.cache.clear();
  }
}
