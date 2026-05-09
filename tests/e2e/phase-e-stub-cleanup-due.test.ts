/**
 * Phase E tripwire — fails if Phase E stub cleanup is overdue.
 *
 * Background: Phase D introduces redirect stubs at old paths (with the
 * AGENT_REDIRECT_ONLY HTML marker) when files move into the new bucket
 * structure. Those stubs are intentional short-term scaffolding to give
 * humans and AI agents a chance to update their stale references. Phase
 * E's job is to delete the stubs once we're confident no inbound refs
 * still target the old paths.
 *
 * This test forces a Phase E PR within 30 days of Phase D's merge:
 *   - Dormant until Phase D merges (test silently passes)
 *   - Within 30 days of D-merge: silently passes (grace window)
 *   - >30 days post-D-merge AND stubs still present: FAILS
 *
 * Self-updating: derives D-merge date from `git log --merges --grep`.
 * No hardcoded literal date. The PR title MUST contain "Phase D" or
 * "phase-D" for this tripwire to fire — see migration map §11
 * coordination gates.
 *
 * Spec: docs/_inventory/PHASE-C-MIGRATION-MAP.md §9.3 (UPDATED in v1.1).
 */

import { execSync } from 'child_process';
import { describe, it, expect } from 'vitest';

// Anchored pattern: a real redirect stub is a line that STARTS with "> Moved to"
// AND contains the AGENT_REDIRECT_ONLY HTML marker. Matching just the marker by
// itself yields false positives — inventory/conventions docs DESCRIBE the stub
// format and contain the marker as documentation, not as a redirect.
const STUB_PATTERN = '^> Moved to .*<!-- AGENT_REDIRECT_ONLY -->';
const GRACE_DAYS = 30;
const GRACE_MS = GRACE_DAYS * 24 * 3600 * 1000;

/**
 * Derive Phase D merge date from git history.
 *
 * Looks for the first merge commit (anywhere on main) whose subject line
 * contains "Phase D" or "phase-D" (case-insensitive). Returns null if no
 * such commit exists yet — in which case the tripwire is dormant.
 */
function phaseDMergeDate(): Date | null {
  try {
    const iso = execSync(
      "git log --merges --format=%aI --grep='Phase D' --grep='phase-D' -i | head -1",
      { encoding: 'utf8' }
    ).trim();
    return iso ? new Date(iso) : null;
  } catch {
    return null;
  }
}

/**
 * Count files in `docs/` containing a real redirect stub.
 * A real stub is a file with at least one line matching `^> Moved to .*<!-- AGENT_REDIRECT_ONLY -->`.
 * Uses git grep -l with -E (extended regex) for speed and to respect .gitignore.
 *
 * Excludes docs/_inventory/ (these files DOCUMENT the stub format in prose,
 * containing the marker as text but not as a redirect — Phase E should not
 * treat them as overdue stubs).
 */
function countStubs(): number {
  try {
    const out = execSync(
      `git grep -l -E '${STUB_PATTERN}' -- docs/ ':!docs/_inventory/' | wc -l`,
      { encoding: 'utf8' }
    ).trim();
    return parseInt(out, 10) || 0;
  } catch {
    return 0;
  }
}

describe('Phase E stub cleanup tripwire', () => {
  it('is not overdue (stubs deleted within 30 days of Phase D merge)', () => {
    const mergeDate = phaseDMergeDate();
    if (!mergeDate) {
      // Phase D hasn't merged yet; tripwire dormant. Test silently passes.
      return;
    }
    const tripwireAt = new Date(mergeDate.getTime() + GRACE_MS);
    if (Date.now() < tripwireAt.getTime()) {
      // Within 30-day grace window. Test silently passes.
      return;
    }
    // Past 30 days. If any stubs remain, fail loudly.
    const stubCount = countStubs();
    expect(stubCount).toBe(0);
  });
});
