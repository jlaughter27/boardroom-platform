#!/usr/bin/env python3
"""
pass-b-rewrite.py — depth-aware rewrite of relative roadmap-internal refs.

Used during Phase D §10 commit 4. Pass A (sed) handles ABSOLUTE paths
(`docs/roadmap/STATUS/X.md` → `docs/STATUS/X.md`). Pass B handles RELATIVE
paths where the leading `../` count must change because the target moved
to a different depth.

Algorithm per ref like `(\.\./)*((STATUS|07-claude-instructions)/X)`:
  1. Resolve current ref against citing file's parent dir to get OLD target abs path
  2. If OLD target abs path is in docs/roadmap/STATUS/ or docs/roadmap/07-claude-instructions/
     AND the target basename is in the §1.2 moved set, the ref needs rewriting.
  3. Compute NEW target abs path: docs/STATUS/X or docs/_meta/X
  4. Compute new ref: relative path from citing file's parent to new target
  5. Replace in file content

Targets `[label](path)` markdown links and backtick `` `path` `` refs.
Reads/writes files in-place. Reports change count per file.
"""

from __future__ import annotations
import os
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]

# Files moved to docs/STATUS/ (5)
MOVED_STATUS = {
    "CURRENT-PHASE.md",
    "CHANGELOG.md",
    "DECISIONS-LOG.md",
    "BLOCKERS.md",
    "PHASE-PROGRESS-TRACKER.md",
}
# Files moved to docs/_meta/ (5)
MOVED_META = {
    "CLAUDE-WORKFLOW.md",
    "CONTEXT-LOAD-ORDER.md",
    "PROMPT-TEMPLATES.md",
    "HANDOFF-TEMPLATE.md",
    "SESSION-END-CHECKLIST.md",
}

# Match `[label](ref)` or `` `ref` `` where ref looks like (../)*STATUS|07-claude-instructions/...
# Capture the ref portion only.
LINK_RE = re.compile(
    r"\[([^\]]*)\]\(((?:\.\./)*(?:STATUS|07-claude-instructions)/[^)\s]+)\)"
)
BACKTICK_RE = re.compile(
    r"`((?:\.\./)*(?:STATUS|07-claude-instructions)/[^`\s]+)`"
)

# Skip these dirs entirely (archives, inventory, disabled code)
SKIP_DIRS = ("docs/_archive/", "docs/_inventory/", "_disabled/", "node_modules/")


def resolve_old_target(citing_file: Path, ref: str) -> Path:
    """Resolve a relative ref against the citing file's parent dir."""
    citing_dir = citing_file.parent
    return (citing_dir / ref).resolve()


def compute_new_ref(citing_file: Path, old_ref: str) -> str | None:
    """Return the new ref string if this ref needs rewriting, else None."""
    citing_dir = citing_file.parent
    old_target = resolve_old_target(citing_file, old_ref)

    try:
        rel_to_repo = old_target.relative_to(REPO_ROOT)
    except ValueError:
        return None

    rel_str = str(rel_to_repo)

    # Determine new target abs path based on whether old target was a moved file
    if rel_str.startswith("docs/roadmap/STATUS/"):
        basename = old_target.name
        if basename in MOVED_STATUS:
            new_target = REPO_ROOT / "docs" / "STATUS" / basename
        else:
            return None  # not a moved file (e.g. PHASE-COMPLETION-CRITERIA.md)
    elif rel_str.startswith("docs/roadmap/07-claude-instructions/"):
        basename = old_target.name
        if basename in MOVED_META:
            new_target = REPO_ROOT / "docs" / "_meta" / basename
        else:
            return None
    else:
        return None

    # Compute new relative ref from citing file's parent to new target
    return os.path.relpath(new_target, citing_dir)


def rewrite_file(path: Path) -> int:
    """Rewrite refs in-place. Return count of replacements."""
    text = path.read_text(encoding="utf-8")
    original = text
    count = 0

    def replace_link(match: re.Match) -> str:
        nonlocal count
        label = match.group(1)
        old_ref = match.group(2)
        new_ref = compute_new_ref(path, old_ref)
        if new_ref is None:
            return match.group(0)
        count += 1
        return f"[{label}]({new_ref})"

    def replace_backtick(match: re.Match) -> str:
        nonlocal count
        old_ref = match.group(1)
        new_ref = compute_new_ref(path, old_ref)
        if new_ref is None:
            return match.group(0)
        count += 1
        return f"`{new_ref}`"

    text = LINK_RE.sub(replace_link, text)
    text = BACKTICK_RE.sub(replace_backtick, text)

    if text != original:
        path.write_text(text, encoding="utf-8")
    return count


def main() -> int:
    docs_dir = REPO_ROOT / "docs"
    total_files_changed = 0
    total_refs_rewritten = 0

    for md_path in docs_dir.rglob("*.md"):
        rel = str(md_path.relative_to(REPO_ROOT))
        if any(rel.startswith(d) or "/" + d.rstrip("/") + "/" in rel for d in SKIP_DIRS):
            continue
        if rel.endswith(".bak"):
            continue
        n = rewrite_file(md_path)
        if n > 0:
            print(f"  {n:3d} refs rewritten in {rel}")
            total_files_changed += 1
            total_refs_rewritten += n

    print(f"\n{total_refs_rewritten} refs rewritten across {total_files_changed} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
