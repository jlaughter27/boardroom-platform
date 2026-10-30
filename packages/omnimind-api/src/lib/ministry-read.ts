import { MINISTRY_TENANT_ID_DEFAULT, isMinistryDomain, isMinistryTenant } from '@boardroom/shared';

/**
 * Fix lane H (2026-10-30) — ministry exclusion on the memory READ paths that
 * serve non-ministry callers (`GET /memories`, `POST /memories/search`,
 * `POST /memories/search-similar`, `POST /context/for-persona`, `GET /graph`,
 * `GET /graph/backlinks/:nodeId`), the same policy as the backlinks route
 * (M5) and the cross-user admin views (lane F):
 *
 *   - a row whose `domain` is ministry in ANY spelling (shared
 *     `isMinistryDomain`: case, padding, `ministry/pastoral`, lookalikes …) is
 *     never listed — whoever asks;
 *   - a row in the ministry tenant (`isMinistryTenant`) is never listed to a
 *     caller outside that tenant (BoardRoom has no tenant, so it is outside).
 *
 * Legacy rows stored before the write gate was hardened are what this guards
 * against: the gate refuses new ministry writes, but `Ministry `,
 * `ministry/pastoral` etc. may still be in the table.
 *
 * Filtering is two-step, like lane F: `ministryExclusionWhere` removes the
 * canonical forms in SQL (a strict subset of `isMinistryRow`, so paging stays
 * close to exact), and `isHiddenMinistryRow` drops every other spelling after
 * the query.
 */

/** The configured ministry tenant id (read per call so tests / operators can set it). */
export function ministryTenantId(): string {
  return process.env.OMNIMIND_MINISTRY_TENANT_ID || MINISTRY_TENANT_ID_DEFAULT;
}

/** True when the caller's own tenant is the ministry tenant. */
export function callerInMinistryTenant(callerTenantId: string | null | undefined): boolean {
  return isMinistryTenant(callerTenantId, ministryTenantId());
}

/** True when a row must not be shown to a caller in `callerTenantId` (undefined = BoardRoom / no tenant). */
export function isHiddenMinistryRow(
  row: { domain?: string | null; tenantId?: string | null },
  callerTenantId?: string | null,
): boolean {
  if (isMinistryDomain(row.domain)) return true;
  if (callerInMinistryTenant(callerTenantId)) return false;
  return isMinistryTenant(row.tenantId, ministryTenantId());
}

/**
 * Prisma `AND` clauses for the canonical ministry forms: `domain` equal to or
 * starting with `ministry` (case-insensitive — every such string is ministry
 * per `isMinistryDomain`), and the ministry tenant unless the caller is in it.
 */
export function ministryExclusionWhere(callerTenantId?: string | null): Array<Record<string, unknown>> {
  const clauses: Array<Record<string, unknown>> = [
    { NOT: { domain: { startsWith: 'ministry', mode: 'insensitive' } } },
  ];
  if (!callerInMinistryTenant(callerTenantId)) {
    clauses.push({ NOT: { tenantId: ministryTenantId() } });
  }
  return clauses;
}
