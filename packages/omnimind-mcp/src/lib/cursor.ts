import { McpValidationError } from '../types';

/**
 * Phase 6 — opaque offset cursors for the paginated list tools.
 *
 * `POST /memories/search` (A2) uses the same encoding (base64 of `{offset}`),
 * so a cursor minted by the API round-trips through the tool unchanged. For
 * `task_list` / `commitment_list` the MCP mints cursors itself and turns them
 * back into `offset=` on `GET /memories`.
 */
export const MAX_PAGE_SIZE = 20;

export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}

/** Returns the offset carried by `cursor`, or 0 when absent. Throws McpValidationError on garbage. */
export function decodeCursor(cursor: string | undefined | null): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { offset?: unknown };
    const offset = parsed?.offset;
    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) throw new Error('bad offset');
    return offset;
  } catch {
    throw new McpValidationError('Invalid tool input: cursor: not a cursor issued by this server', [
      { path: 'cursor', message: 'not a cursor issued by this server' },
    ]);
  }
}

/**
 * Offset pagination helper: callers fetch `limit + 1` rows; this trims the
 * page and mints `nextCursor` only when a further row exists.
 */
export function pageOf<T>(rows: T[], offset: number, limit: number): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? encodeCursor(offset + limit) : null };
}
