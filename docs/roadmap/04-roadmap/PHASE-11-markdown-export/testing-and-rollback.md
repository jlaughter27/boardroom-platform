# PHASE 11 — Testing & Rollback

## Verification

1. **Vault assembly:** unit + snapshot tests on every renderer. Snapshot diff in PR review catches accidental frontmatter changes that would break re-import.
2. **Round-trip eval:** `npm run eval:all` runs `vault-roundtrip.scenario.ts` and exits 0. This is the phase exit gate.
3. **Manual flow:** test user authorizes GitHub, runs export, opens the resulting repo in Obsidian, verifies wikilinks render and frontmatter is parseable. Edit a memory in Obsidian, push to GitHub, run import, see the change reflected.
4. **Conflict scenario:** edit the same memory in both DB (via API) and markdown (via Obsidian + push). Run import. Verify a `_conflicts/{id}-{timestamp}.md` file appears with the losing version and the winning version is in the DB.
5. **Idempotency:** run export twice in a row with no changes. Second run produces zero commits.
6. **Token expiry:** revoke the GitHub OAuth grant from GitHub's UI. Run export. Verify the user receives a "reconnect needed" notification and `OAuthToken.needsReauth = true`.
7. **Large vault:** seed a test user with 1k memories. Export should complete in <5 min. Memory usage during export should stay under 200 MB additional.
8. **No regressions:** `pnpm typecheck && pnpm test && npm run eval:all` all green.

## Rollback

**Soft rollback:**
- Set `VAULT_EXPORT_ENABLED=false` in Railway env. Routes return 503 with a "feature paused" message. Existing user repos are untouched (they live on GitHub). New exports stop.

**Hard rollback (revert):**
- Revert the merge. New routes, new files, new tables. The `ExportJob` and `ImportJob` tables can stay (no harm) or be dropped via a separate migration once we're confident.
- The `OAuthToken` schema change (extending the provider enum value to `'github-vault'`) is additive — leaving it in place after revert is safe.
- User-side: their `omnimind-vault-{userId}` repos persist on GitHub; we never delete them. If they want to clean up, they revoke the OAuth grant in their GitHub settings.

**Data integrity rollback:** if a botched import overwrites DB data, recover from the previous nightly `pg_dump` (Phase 18 sets up off-Railway backups; until then, request a Railway support restore).

**Failure modes to watch:**
- **Forked vault drift.** A user clones their vault, edits offline for weeks, then pushes. The `_conflicts/` folder may grow large. Add a prune-old-conflicts cron at >30d age.
- **Wikilink rot.** If a user renames an entity file in Obsidian, downstream wikilinks break on re-import. Mitigation: the parser (Task 11.7) resolves wikilinks by `id` (read from frontmatter), not filename — filename is cosmetic.
- **Repo size.** A power user with 10k memories produces a ~50MB repo. Within GitHub limits but slow. Document a "vault prune" feature for v2.
- **GitHub API rate limit.** 5000 req/hour authenticated. A bulk re-export touching many files could brush against this. Use git's batch operations (single commit, single push), not file-by-file API calls.
