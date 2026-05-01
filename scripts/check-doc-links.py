#!/usr/bin/env python3
"""
check-doc-links.py — assert all doc-path references in entry-point docs
resolve to existing files. Exits non-zero on any miss. Designed to run
from repo root via `python3 scripts/check-doc-links.py` and intended for
pre-deploy CI.

Scope (per migration map §9.2):
- CLAUDE.md (root)
- .claude/CLAUDE.md
- packages/*/CLAUDE.md (the 3 nested CLAUDE.md files)
- README.md
- scripts/pre-deploy-check.sh

Reuses the parsing approach from docs/_inventory/scripts/inventory.py but
scoped narrowly to the entry-point docs, not the full tree. Only flags
broken refs in those 5-7 files; the inventory script is the right tool
for full-tree audits.

Detection patterns:
1. Markdown links:           [label](path)
2. Backtick-wrapped paths:   `docs/foo/bar.md`
3. Bare-text doc paths:      docs/foo/bar.md (with surrounding whitespace)

References are resolved relative to the file containing them. URLs
(http://, https://, mailto:) and external anchors are skipped.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Iterable

REPO_ROOT = Path(__file__).resolve().parent.parent

# Markdown link:  [label](path)  — captures path portion
MD_LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
# Backtick-wrapped doc path:  `docs/foo.md`, `packages/.../bar.ts`, `scripts/x.sh`
BACKTICK_RE = re.compile(
    r"`((?:docs|packages|scripts|tests|eval)/[^`\s]+)`"
)
# Bare-text doc path:  docs/foo.md or .claude/CLAUDE.md (must end in .md/.json/.ts/.tsx/.sh/.py)
BARE_PATH_RE = re.compile(
    r"(?:^|[\s(\[])((?:docs|packages|scripts|tests|eval|\.claude)/[A-Za-z0-9_./-]+\.(?:md|json|ts|tsx|sh|py|prisma))(?=[\s)\],.;:!?'\"]|$)"
)

# References starting with these prefixes are "interesting" (in-repo doc/code paths)
INTERESTING_PREFIXES = ("docs/", ".claude/", "packages/", "scripts/", "tests/", "eval/")
# Skip these (URLs, anchors, placeholders)
SKIP_PREFIXES = ("http://", "https://", "mailto:", "#", "//")
# Glob/template metacharacters — these are patterns, not literal paths, and should be skipped
GLOB_CHARS = re.compile(r"[*?{}\[\]]")


def entry_point_files() -> list[Path]:
    """Return the entry-point doc files to scan."""
    files = [
        REPO_ROOT / "CLAUDE.md",
        REPO_ROOT / ".claude" / "CLAUDE.md",
        REPO_ROOT / "README.md",
        REPO_ROOT / "scripts" / "pre-deploy-check.sh",
    ]
    files.extend((REPO_ROOT / "packages").glob("*/CLAUDE.md"))
    return [f for f in files if f.exists()]


def extract_refs(text: str) -> Iterable[str]:
    """Extract all in-repo path references from text. Yields path strings."""
    seen: set[str] = set()
    for pat in (MD_LINK_RE, BACKTICK_RE, BARE_PATH_RE):
        for match in pat.finditer(text):
            ref = match.group(1).strip()
            # Strip URL fragments, anchor markers, query strings
            ref = ref.split("#", 1)[0].split("?", 1)[0].strip()
            if not ref:
                continue
            if any(ref.startswith(p) for p in SKIP_PREFIXES):
                continue
            # Trim trailing comma/period that snuck in
            ref = ref.rstrip(",.;:")
            # Only keep refs that look like in-repo paths
            if not ref.startswith(INTERESTING_PREFIXES) and not ref.startswith("../"):
                continue
            # Skip glob patterns and template placeholders — they're not literal paths
            if GLOB_CHARS.search(ref):
                continue
            if ref in seen:
                continue
            seen.add(ref)
            yield ref


def resolve_ref(src_file: Path, ref: str) -> Path | None:
    """Resolve a reference to an absolute path. None if it can't be resolved."""
    # Relative refs: resolve from src file's parent directory
    if ref.startswith("../") or ref.startswith("./"):
        target = (src_file.parent / ref).resolve()
        return target if str(target).startswith(str(REPO_ROOT)) else None
    # Absolute repo-root refs: resolve from REPO_ROOT
    return (REPO_ROOT / ref).resolve()


def check_file(src_file: Path) -> list[tuple[str, str]]:
    """Return a list of (ref, reason) for broken references in src_file."""
    text = src_file.read_text(encoding="utf-8", errors="ignore")
    misses: list[tuple[str, str]] = []
    for ref in extract_refs(text):
        target = resolve_ref(src_file, ref)
        if target is None:
            misses.append((ref, "resolves outside repo"))
            continue
        # Allow dir refs with trailing slash
        if not target.exists() and not target.with_suffix(target.suffix.rstrip("/")).exists():
            misses.append((ref, f"missing: {target.relative_to(REPO_ROOT) if REPO_ROOT in target.parents else target}"))
    return misses


def main() -> int:
    total_misses: list[tuple[Path, str, str]] = []
    files = entry_point_files()
    for src_file in files:
        for ref, reason in check_file(src_file):
            total_misses.append((src_file, ref, reason))
    if total_misses:
        print(f"FAIL: {len(total_misses)} broken doc-path reference(s) in entry-point docs:")
        for src, ref, reason in total_misses:
            rel = src.relative_to(REPO_ROOT)
            print(f"  {rel}: {ref}  [{reason}]")
        return 1
    print(f"OK: all doc-path references in {len(files)} entry-point docs resolve")
    return 0


if __name__ == "__main__":
    sys.exit(main())
