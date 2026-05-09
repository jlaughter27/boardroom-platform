# Handoff Template

**Audience:** Claude, end of session.
**Purpose:** Standardized format for what to write into `STATUS/` before ending. Ensures the next session picks up cold without lost context.

---

## End-of-session checklist

Before you finish, append entries to:

### 1. `STATUS/CHANGELOG.md`

```markdown
## YYYY-MM-DD — Phase X — Brief action title

- What was done (1-3 bullets)
- Files touched (paths)
- Tests run + result
- Deploy status (if applicable)

Next session: [what's next]
```

### 2. `STATUS/CURRENT-PHASE.md` (overwrite, don't append)

Update if any of these changed:
- Active phase number
- Next 5 actions list
- Open decisions

### 3. `STATUS/DECISIONS-LOG.md`

If you made any non-trivial decision, add an entry. Format in the file.

### 4. `STATUS/BLOCKERS.md`

If something is now blocked, add it. If something was unblocked, remove it.

---

## What "non-trivial decision" means

Add to DECISIONS-LOG if you:
- Picked one technical approach over another with the user's input
- Deferred something that was previously planned
- Added something that wasn't in the roadmap
- Discovered a constraint that changes how a phase should be built

Don't add to DECISIONS-LOG for:
- Routine code edits
- Bug fixes that don't change architecture
- Following an existing plan as written

---

## What to do if you can't update STATUS/

If STATUS/ is in conflict (e.g., merge conflict from concurrent work) or you're not sure how to summarize:
1. Don't end the session silently
2. Tell the user explicitly: "I made changes but couldn't update STATUS/ because [reason]"
3. The user will either help resolve, or accept the lost-context risk knowingly

---

## Anti-patterns

- Updating STATUS/ at the *start* of a session "to plan." STATUS/ reflects what shipped, not what's planned.
- Editing CHANGELOG.md retroactively. It's append-only.
- Skipping updates because "the work was small." Even small work updates BLOCKERS.md if it unblocked something.
- Putting decisions in CHANGELOG.md instead of DECISIONS-LOG.md. Different files for different purposes.
