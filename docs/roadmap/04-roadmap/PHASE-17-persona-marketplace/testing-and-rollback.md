# PHASE 17 — Testing & Rollback

## Verification

1. **End-to-end eval:** `eval/scenarios/persona-marketplace-e2e.scenario.ts` exercises install → invoke → restrict → uninstall and per-tenant isolation. This is the phase exit gate.
2. **Tool restriction enforcement:** unit + eval coverage verifies the runtime blocks denied tools regardless of prompt content. This is a security boundary.
3. **Signature verification:** real sigstore flow on a sample persona; tamper detection produces 'untrusted' status.
4. **Hash integrity:** any tampered manifest or prompt fails the hash check at install time.
5. **Per-user persona cap:** install 50; the 51st returns 429 with a clear message.
6. **Manual install via Claude Desktop:** complete the install flow from a real Claude Desktop session, observe the persona become available, invoke it.
7. **No regressions:** `pnpm typecheck && pnpm test && npm run eval:all` all green.

## Rollback

**Soft rollback:**
- Set `PERSONA_MARKETPLACE_ENABLED=false`. Install routes return 503; uninstall remains available; existing installed personas continue to invoke normally. Users can still rely on first-party personas.

**Hard rollback (revert):**
- Revert the merge commits.
- The `CustomPersona` schema additions stay (additive; safe to leave).
- Installed personas remain in the table; they still work because they're stored as `prompt` text — the runtime invokes them as before. The new fields (`sourceUrl`, `signatureStatus`, etc.) become unused.
- Discovery page (marketing site) keeps rendering whatever JSON was last published; no harm.

**Security incident rollback:**
If a malicious persona is published and installed by users:
1. Revoke the persona's source URL via a denylist (env var `PERSONA_INSTALL_DENYLIST` checked at install time and at invocation time).
2. Force-soft-delete all installed instances of that persona: `UPDATE "CustomPersona" SET "deletedAt" = now() WHERE "sourceUrl" = '...'`.
3. Notify affected users (use the webhook/email pipeline).
4. Document the incident in `docs/SECURITY-INCIDENTS.md`; submit a CVE if appropriate.

**Failure modes to watch:**
- **Prompt injection in unverified personas.** Even with tool restrictions, a persona prompt could attempt to manipulate the user. Mitigation: prominent "unverified" UI badge; documentation of the trust model. The runtime cannot fully prevent prompt-injection — that's a known limitation of LLM systems documented openly.
- **GitHub rate limit.** Unauthenticated install fetches from GitHub hit 60 req/hour per IP. Mitigation: install via OAuth-authenticated user when possible (5000 req/hour); cache install attempts per source URL.
- **Sigstore service availability.** If sigstore is down, signature verification fails — personas appear 'unverified' falsely. Mitigation: cache verification results for 24h; surface "signature check failed (retry later)" status distinct from 'untrusted'.
- **Tool restriction bypass via persona-to-persona invocation.** If persona A invokes persona B (future feature), B's restrictions might leak A's tool access. Mitigation: when invoking a chained persona, intersect (not union) the restriction lists. Document and test in the eval scenario.
- **Manifest schema drift.** Future manifest_version increments must be backward-compatible or gated by a runtime check. The Zod schema discriminates on `manifest_version` literal.
