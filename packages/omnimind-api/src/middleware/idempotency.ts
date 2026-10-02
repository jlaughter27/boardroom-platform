/**
 * Phase 6 (A2) — `Idempotency-Key` middleware for write routes.
 *
 * Contract (PHASE-6-CONTRACTS.md › Idempotency):
 *   - header `Idempotency-Key` (≤128 chars); absent → the route runs as usual
 *   - scope = `req.agentContext.agentId` when present, else `x-user-id`
 *   - hit (same scope+key, not expired, 24 h TTL) → replay the stored body with
 *     the original status and `Idempotent-Replayed: true`
 *   - miss → run the handler; on a 2xx JSON response store `{status, body}`
 *   - a key reused on a different route is refused (422 `idempotency_key_reused`)
 *   - concurrent duplicates: the unique (scope, key) constraint makes the
 *     second writer's store fail → it re-reads and replays the stored result
 *   - expired rows are deleted lazily (at most once per cleanup interval, and
 *     on the hit path when the row found is stale)
 *
 * Storage: `IdempotencyKey` (scope, key, route, resultId?, resultJson?,
 * expiresAt; unique scope+key). `resultJson` = `{ status, body }`.
 *
 * Apply per route: `router.post('/', idempotent('memories.create'), handler)`.
 * Only JSON responses sent through `res.json()` are captured.
 */

import type { NextFunction, Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../lib/db';
import { logger } from '../lib/logger';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const IDEMPOTENCY_REPLAY_HEADER = 'Idempotent-Replayed';
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

interface StoredResult { status: number; body: unknown }

/** The subset of PrismaClient this middleware touches — lets tests pass a fake. */
export type IdempotencyPrisma = Pick<PrismaClient, 'idempotencyKey'>;

export interface IdempotentOptions {
  prisma?: IdempotencyPrisma;
  now?: () => Date;
}

let lastCleanupAt = 0;

export function __resetIdempotencyStateForTest(): void {
  lastCleanupAt = 0;
}

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'P2002';
}

function readKey(req: Request): string | null {
  const v = req.headers[IDEMPOTENCY_HEADER];
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  return trimmed.length ? trimmed : null;
}

function resolveScope(req: Request): string | null {
  const agentId = req.agentContext?.agentId;
  if (agentId) return `agent:${agentId}`;
  const userId = req.headers['x-user-id'];
  const s = Array.isArray(userId) ? userId[0] : userId;
  return typeof s === 'string' && s.trim().length ? `user:${s.trim()}` : null;
}

function replay(res: Response, stored: StoredResult): void {
  res.setHeader(IDEMPOTENCY_REPLAY_HEADER, 'true');
  res.status(stored.status).json(stored.body);
}

function toStored(row: { resultJson: unknown }): StoredResult | null {
  const j = row.resultJson as { status?: unknown; body?: unknown } | null;
  if (!j || typeof j !== 'object' || typeof j.status !== 'number') return null;
  return { status: j.status, body: j.body ?? null };
}

async function lazyCleanup(db: IdempotencyPrisma, now: Date): Promise<void> {
  if (now.getTime() - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now.getTime();
  try {
    await db.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } });
  } catch (err) {
    logger.warn('idempotency: lazy cleanup failed', { error: (err as Error).message });
  }
}

export function idempotent(routeName: string, options: IdempotentOptions = {}) {
  const now = options.now ?? (() => new Date());

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = readKey(req);
    if (!key) { next(); return; }

    if (key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
      res.status(400).json({
        error: 'validation_failed',
        details: [{ field: 'Idempotency-Key', message: `Idempotency-Key must be at most ${IDEMPOTENCY_KEY_MAX_LENGTH} characters` }],
      });
      return;
    }

    const scope = resolveScope(req);
    if (!scope) { next(); return; } // the route itself answers 400 for the missing x-user-id

    const db = options.prisma ?? defaultPrisma;
    if (!db || typeof (db as { idempotencyKey?: unknown }).idempotencyKey !== 'object') {
      next(); // pre-migration client / minimal mock — behave as if the header were absent
      return;
    }

    const startedAt = now();
    void lazyCleanup(db, startedAt);

    // ── Hit? ────────────────────────────────────────────────────────────────
    try {
      const existing = await db.idempotencyKey.findUnique({ where: { scope_key: { scope, key } } });
      if (existing) {
        if (existing.expiresAt.getTime() > startedAt.getTime()) {
          if (existing.route !== routeName) {
            res.status(422).json({
              error: 'idempotency_key_reused',
              message: `Idempotency-Key was already used for ${existing.route}`,
            });
            return;
          }
          const stored = toStored(existing);
          if (stored) { replay(res, stored); return; }
          // Row without a usable result (should not happen) — fall through and overwrite.
        }
        await db.idempotencyKey.deleteMany({ where: { scope, key } }).catch(() => undefined);
      }
    } catch (err) {
      // Storage trouble must not block the write; log and run the handler.
      logger.error('idempotency: lookup failed — proceeding without replay', { route: routeName, error: (err as Error).message });
      next();
      return;
    }

    // ── Miss: capture the handler's JSON response and store it on success ──
    let status = 200;
    const originalStatus = res.status.bind(res);
    const originalJson = res.json.bind(res);

    res.status = ((code: number) => {
      status = code;
      return originalStatus(code);
    }) as Response['status'];

    res.json = ((body: unknown) => {
      // Sending happens after the (async) store attempt; Express callers do
      // not await res.json(), so the returned `res` is enough.
      void (async () => {
        if (status < 200 || status >= 300) { originalJson(body); return; }
        const resultId = body && typeof body === 'object' && typeof (body as { id?: unknown }).id === 'string'
          ? (body as { id: string }).id
          : null;
        try {
          await db.idempotencyKey.create({
            data: {
              scope,
              key,
              route: routeName,
              resultId,
              resultJson: { status, body } as object,
              expiresAt: new Date(startedAt.getTime() + IDEMPOTENCY_TTL_MS),
            },
          });
          originalJson(body);
        } catch (err) {
          if (isUniqueViolation(err)) {
            // Concurrent duplicate won the race: replay what it stored.
            try {
              const winner = await db.idempotencyKey.findUnique({ where: { scope_key: { scope, key } } });
              const stored = winner ? toStored(winner) : null;
              if (stored && winner!.route === routeName) {
                res.setHeader(IDEMPOTENCY_REPLAY_HEADER, 'true');
                originalStatus(stored.status);
                originalJson(stored.body);
                return;
              }
            } catch (readErr) {
              logger.warn('idempotency: re-read after unique violation failed', { route: routeName, error: (readErr as Error).message });
            }
          } else {
            logger.error('idempotency: store failed — response sent without replay record', { route: routeName, error: (err as Error).message });
          }
          originalJson(body);
        }
      })();
      return res;
    }) as Response['json'];

    next();
  };
}
