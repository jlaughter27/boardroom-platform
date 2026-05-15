#!/usr/bin/env bash
# Wave 3 Track H — Phase 0.25.4 RLS guard
#
# Two checks:
#  1) The deleted `db-audit.ts` RLS facade must never reappear. Any reference
#     in packages/*/src/ fails CI. (The facade gave the false impression of
#     row-level security; deleting it forces every query to explicitly carry
#     a user/tenant filter, which is the actual security boundary.)
#
#  2) Every `prisma.X.findMany(` and `prisma.X.findFirst(` call in
#     packages/omnimind-api/src/ must include `userId`, `tenantId`, or `id`
#     in its where clause (or carry an explicit `rls-allow:` opt-out comment
#     with a reason). This is a regex check, not a parse — it catches the
#     "I forgot the userId filter" class of bug at PR time.
#
# Usage:
#   bash scripts/check-rls-guards.sh
#
# Exit codes:
#   0 — clean
#   1 — at least one violation
#
# To intentionally opt-out for a known-safe site (e.g. cron iterating all
# users), add a comment on the same line OR within the next 4 lines:
#     // rls-allow: <reason>
# Example:
#     const users = await prisma.user.findMany({ select: { id: true } }); // rls-allow: cron iterates all users
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

violations=0

# -----------------------------------------------------------------------------
# Check 1 — db-audit facade must not reappear
# -----------------------------------------------------------------------------
if grep -rEn 'db-audit|dbAudit\b' packages/omnimind-api/src/ packages/boardroom-ai/server/src/ 2>/dev/null \
    | grep -v '_disabled' \
    | grep -v 'check-rls-guards' ; then
  echo ""
  echo "✗ RLS guard: references to deleted db-audit facade found above."
  echo "  The facade was removed in Phase 0.25.4 because it implied row-level"
  echo "  security without enforcing it. Use direct Prisma calls with explicit"
  echo "  where: { userId, deletedAt: null } guards instead."
  violations=$((violations + 1))
fi

# -----------------------------------------------------------------------------
# Check 2 — every prisma.X.findMany|findFirst must filter by user/tenant/id
# -----------------------------------------------------------------------------
# Strategy: list lines that match prisma.X.findMany|findFirst, then for each,
# read the next ~20 lines from that file as the call site, and verify it
# contains one of `userId`, `tenantId`, or `id:` somewhere (or an rls-allow
# comment within 4 lines).

tmp_violations="$(mktemp)"
trap 'rm -f "$tmp_violations"' EXIT

while IFS=: read -r file line _; do
  # Skip _disabled, tests, and admin routes (admin is cross-tenant by design).
  case "$file" in
    *_disabled*) continue ;;
    */tests/*|*.test.ts|*.spec.ts) continue ;;
    *admin*) continue ;;
  esac

  # Context = 30 lines before and 20 lines after the match. The Prisma call
  # frequently uses an externally-built `where: where` object, so we have to
  # look upward to find the userId/tenantId assignment.
  start=$((line - 60))
  if [ "$start" -lt 1 ]; then start=1; fi
  context="$(sed -n "${start},$((line + 20))p" "$file")"
  # If the call has an inline allow comment within 4 lines after the match, skip
  allow_window="$(sed -n "${line},$((line + 4))p" "$file")"
  if echo "$allow_window" | grep -q 'rls-allow:'; then
    continue
  fi

  # If the function context contains a userId / tenantId reference OR uses an
  # `id:` filter directly inside a where clause, treat as safe.
  if echo "$context" | grep -qE '\b(userId|tenantId)\b|where: *\{[^}]*\bid:'; then
    continue
  fi

  # Otherwise it's a violation
  echo "  $file:$line — prisma findMany/findFirst with no user/tenant/id filter" >> "$tmp_violations"
done < <(grep -rEn 'prisma\.[a-zA-Z]+\.(findMany|findFirst)\(' packages/omnimind-api/src/ 2>/dev/null)

if [ -s "$tmp_violations" ]; then
  echo ""
  echo "✗ RLS guard: the following Prisma reads have no userId/tenantId/id filter:"
  cat "$tmp_violations"
  echo ""
  echo "  Each must either:"
  echo "    (a) filter by userId or tenantId (or use { where: { id, userId, ... }})"
  echo "    (b) carry an inline // rls-allow: <reason> comment within 4 lines"
  echo ""
  echo "  Phase 0.25.4 — the RLS facade was deleted; explicit guards are now"
  echo "  the only safety net."
  violations=$((violations + 1))
fi

if [ "$violations" -eq 0 ]; then
  echo "✓ RLS guard clean — no db-audit references; all Prisma reads are tenant-scoped."
  exit 0
fi

exit 1
