#!/usr/bin/env python3
"""
Phase A docs inventory — read-only.

Scans repo root *.md + docs/**/*.md and produces:
  docs/_inventory/files.json   — manifest with size, mtime, type, inbound, outbound
  docs/_inventory/orphans.md   — zero-inbound files outside known entry list
  docs/_inventory/hubs.md      — most-referenced files
  docs/_inventory/summary.md   — 1-page summary

No file moves, no edits to scanned files. Pure observation.
"""

from __future__ import annotations

import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DOCS = REPO_ROOT / "docs"
INVENTORY_DIR = REPO_ROOT / "docs" / "_inventory"

# Paths considered "entry points" — we don't flag these as orphans even if no file points to them
ENTRY_POINTS = {
    "CLAUDE.md",
    "README.md",
    ".claude/CLAUDE.md",
    "docs/MASTER-FRAMEWORK.md",
    "docs/PROJECT-BRIEF.md",
    "docs/roadmap/STATUS/CURRENT-PHASE.md",
    "docs/roadmap/07-claude-instructions/CLAUDE-WORKFLOW.md",
}

# Type classification by path prefix (first match wins)
TYPE_RULES: list[tuple[str, str]] = [
    ("docs/_inventory/", "inventory"),
    ("docs/_archive/", "archive"),
    ("docs/prompts/", "prompts"),
    ("docs/contracts/", "architecture"),
    ("docs/schemas/", "architecture"),
    ("docs/architecture/", "architecture"),
    ("docs/roadmap/STATUS/", "status"),
    ("docs/roadmap/07-claude-instructions/", "instructions"),
    ("docs/roadmap/", "roadmap"),
    ("docs/tasks/", "tasks"),
    ("docs/research/", "research"),
    ("CLAUDE.md", "instructions"),
    (".claude/", "instructions"),
    ("docs/MEM0_", "archive-candidate"),
    ("docs/", "product-doc"),
    ("", "root"),
]

LINK_PATTERNS = [
    # [text](path.md) or [text](path.md#anchor) — markdown link
    re.compile(r"\[[^\]]*\]\(([^)\s]+\.md(?:#[^)\s]*)?)\)"),
    # [text](path/) — directory-style link, will be expanded to README.md
    re.compile(r"\[[^\]]*\]\(([^)\s]+/)\)"),
    # bare reference like `docs/foo/bar.md` inside backticks
    re.compile(r"`([^`\s]+\.md)`"),
    # bare ref in plain text — best effort
    re.compile(r"(?<![\w/\-(\[])((?:\.\./|\./)?[\w./\-]+\.md)(?![\w])"),
]

# Paths matching these globs get expanded against the filesystem
GLOB_RE = re.compile(r"\*")


def classify(rel_path: str) -> str:
    for prefix, label in TYPE_RULES:
        if rel_path.startswith(prefix):
            return label
    return "other"


def is_in_scope(p: Path) -> bool:
    rel = p.relative_to(REPO_ROOT).as_posix()
    if rel.startswith("node_modules/"):
        return False
    if "/node_modules/" in rel:
        return False
    if rel.startswith("docs/_inventory/"):
        return False  # Don't inventory the inventory itself
    return True


def collect_files() -> list[Path]:
    files: list[Path] = []
    # Root-level .md
    for p in REPO_ROOT.glob("*.md"):
        if is_in_scope(p):
            files.append(p)
    # .claude/CLAUDE.md
    claude_md = REPO_ROOT / ".claude" / "CLAUDE.md"
    if claude_md.exists():
        files.append(claude_md)
    # All docs/**/*.md
    for p in DOCS.rglob("*.md"):
        if is_in_scope(p):
            files.append(p)
    return sorted(set(files))


def _resolve_one(raw: str, src_dir: Path) -> Path | None:
    """Try multiple bases to resolve `raw` to an existing file.

    Returns the resolved Path if one exists, otherwise the first attempted
    candidate (so we still record an unresolved ref for inspection)."""
    candidates: list[Path] = []
    try:
        if raw.startswith("/"):
            candidates.append((REPO_ROOT / raw.lstrip("/")).resolve())
        elif raw.startswith(("./", "../")):
            candidates.append((src_dir / raw).resolve())
        else:
            # Bare path — try source-dir, then walk up ancestors, then repo-root
            candidates.append((src_dir / raw).resolve())
            ancestor = src_dir.parent
            while True:
                try:
                    ancestor.relative_to(REPO_ROOT)
                except ValueError:
                    break
                candidates.append((ancestor / raw).resolve())
                if ancestor == REPO_ROOT:
                    break
                ancestor = ancestor.parent
            candidates.append((REPO_ROOT / raw).resolve())
    except (OSError, ValueError):
        return None

    for c in candidates:
        if c.exists():
            return c
    return candidates[0] if candidates else None


def extract_refs(file_path: Path, content: str) -> set[str]:
    """Return set of relative-to-repo paths this file references."""
    refs: set[str] = set()
    src_dir = file_path.parent
    for pat in LINK_PATTERNS:
        for m in pat.finditer(content):
            raw = m.group(1)
            # Strip anchor
            raw = raw.split("#", 1)[0]
            # Skip URLs
            if raw.startswith(("http://", "https://", "mailto:")):
                continue
            if not raw:
                continue

            # Directory-style link → try as <dir>/README.md
            if raw.endswith("/"):
                raw_md = raw + "README.md"
            elif raw.endswith(".md"):
                raw_md = raw
            else:
                continue

            # Glob expansion — walk filesystem
            if GLOB_RE.search(raw_md):
                # Pick a base to glob from
                if raw_md.startswith("/"):
                    base = REPO_ROOT
                    pattern = raw_md.lstrip("/")
                elif raw_md.startswith(("./", "../")):
                    base = (src_dir / raw_md).parent.resolve()
                    pattern = Path(raw_md).name
                else:
                    # Try source-dir first; if no matches, repo-root
                    base = src_dir
                    pattern = raw_md
                try:
                    matches = list(base.glob(pattern))
                    if not matches:
                        # Fallback: repo-root glob
                        matches = list(REPO_ROOT.glob(raw_md.lstrip("/")))
                    for m_path in matches:
                        try:
                            rel = m_path.resolve().relative_to(REPO_ROOT).as_posix()
                            refs.add(rel)
                        except ValueError:
                            continue
                except (OSError, ValueError):
                    pass
                continue

            chosen = _resolve_one(raw_md, src_dir)
            if chosen is None:
                continue
            try:
                rel = chosen.relative_to(REPO_ROOT).as_posix()
            except ValueError:
                continue
            refs.add(rel)
    return refs


def main() -> int:
    files = collect_files()
    if not files:
        print("No files found.", file=sys.stderr)
        return 1

    rel_paths = [f.relative_to(REPO_ROOT).as_posix() for f in files]
    rel_set = set(rel_paths)

    manifest: dict[str, dict] = {}
    outbound: dict[str, list[str]] = {}
    inbound: dict[str, list[str]] = defaultdict(list)
    unresolved_targets: dict[str, set[str]] = defaultdict(set)

    for f in files:
        rel = f.relative_to(REPO_ROOT).as_posix()
        try:
            content = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            content = ""
        refs = extract_refs(f, content)
        # Split refs into resolved (in-scope) and unresolved
        resolved = sorted(r for r in refs if r in rel_set)
        unresolved = sorted(r for r in refs if r not in rel_set)
        outbound[rel] = resolved
        for u in unresolved:
            unresolved_targets[rel].add(u)
        for r in resolved:
            inbound[r].append(rel)

        stat = f.stat()
        manifest[rel] = {
            "path": rel,
            "size_bytes": stat.st_size,
            "lines": content.count("\n") + (0 if content.endswith("\n") else 1),
            "mtime": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(timespec="seconds"),
            "type": classify(rel),
            "is_entry_point": rel in ENTRY_POINTS,
            "outbound_count": len(resolved),
            "outbound": resolved,
            "unresolved_refs": sorted(unresolved),
        }

    # Now stitch inbound
    for rel in manifest:
        manifest[rel]["inbound_count"] = len(inbound[rel])
        manifest[rel]["inbound"] = sorted(inbound[rel])

    # Aggregate stats
    by_type: dict[str, int] = defaultdict(int)
    by_type_size: dict[str, int] = defaultdict(int)
    for rel, meta in manifest.items():
        by_type[meta["type"]] += 1
        by_type_size[meta["type"]] += meta["size_bytes"]

    orphans = [
        rel for rel, meta in manifest.items()
        if meta["inbound_count"] == 0
        and not meta["is_entry_point"]
        and meta["type"] not in ("inventory",)
    ]

    hubs = sorted(
        manifest.items(),
        key=lambda kv: kv[1]["inbound_count"],
        reverse=True,
    )

    INVENTORY_DIR.mkdir(parents=True, exist_ok=True)

    # Write manifest JSON
    manifest_path = INVENTORY_DIR / "files.json"
    with manifest_path.open("w", encoding="utf-8") as f:
        json.dump(
            {
                "generated_at": datetime.now(tz=timezone.utc).isoformat(timespec="seconds"),
                "repo_root": str(REPO_ROOT),
                "file_count": len(manifest),
                "by_type_count": dict(by_type),
                "by_type_total_bytes": dict(by_type_size),
                "files": manifest,
            },
            f,
            indent=2,
            sort_keys=True,
        )

    # Orphans report
    orphans_path = INVENTORY_DIR / "orphans.md"
    with orphans_path.open("w", encoding="utf-8") as f:
        f.write(f"# Orphan files (no inbound .md references)\n\n")
        f.write(f"Generated {datetime.now(tz=timezone.utc).isoformat(timespec='seconds')}\n\n")
        f.write(f"Total: {len(orphans)} of {len(manifest)} files\n\n")
        f.write("> Files with `inbound_count == 0` that are not declared entry points.\n")
        f.write("> Inclusion here doesn't mean delete — it means *no other doc points at this*.\n")
        f.write("> Could be: archived correctly, never indexed, or genuinely abandoned.\n\n")
        # Group by type
        by_t: dict[str, list[str]] = defaultdict(list)
        for rel in orphans:
            by_t[manifest[rel]["type"]].append(rel)
        for t in sorted(by_t):
            f.write(f"## type: `{t}` ({len(by_t[t])})\n\n")
            for rel in sorted(by_t[t]):
                size_kb = manifest[rel]["size_bytes"] / 1024
                f.write(f"- `{rel}` ({size_kb:.1f}kb, {manifest[rel]['lines']} lines)\n")
            f.write("\n")

    # Hubs report
    hubs_path = INVENTORY_DIR / "hubs.md"
    with hubs_path.open("w", encoding="utf-8") as f:
        f.write(f"# Hub files (most inbound references)\n\n")
        f.write(f"Generated {datetime.now(tz=timezone.utc).isoformat(timespec='seconds')}\n\n")
        f.write("> These are load-bearing. Moving them requires updating every inbound reference.\n\n")
        f.write("| Inbound | File | Type | Size |\n")
        f.write("|---:|---|---|---:|\n")
        for rel, meta in hubs[:40]:
            if meta["inbound_count"] == 0:
                break
            size_kb = meta["size_bytes"] / 1024
            f.write(f"| {meta['inbound_count']} | `{rel}` | {meta['type']} | {size_kb:.1f}kb |\n")

    # Summary
    summary_path = INVENTORY_DIR / "summary.md"
    with summary_path.open("w", encoding="utf-8") as f:
        f.write(f"# Phase A inventory — summary\n\n")
        f.write(f"Generated {datetime.now(tz=timezone.utc).isoformat(timespec='seconds')}\n\n")
        f.write(f"## Totals\n\n")
        f.write(f"- **Files scanned:** {len(manifest)}\n")
        total_bytes = sum(m["size_bytes"] for m in manifest.values())
        f.write(f"- **Total size:** {total_bytes/1024:.0f}kb ({total_bytes/1024/1024:.1f}MB)\n")
        f.write(f"- **Entry points:** {sum(1 for m in manifest.values() if m['is_entry_point'])}\n")
        f.write(f"- **Orphans:** {len(orphans)}\n")
        f.write(f"- **Hubs (≥3 inbound):** {sum(1 for m in manifest.values() if m['inbound_count'] >= 3)}\n\n")

        f.write(f"## By type\n\n")
        f.write(f"| Type | Count | Total kb |\n|---|---:|---:|\n")
        for t in sorted(by_type, key=lambda k: -by_type[k]):
            f.write(f"| {t} | {by_type[t]} | {by_type_size[t]/1024:.0f} |\n")
        f.write("\n")

        # Largest files
        biggest = sorted(manifest.items(), key=lambda kv: -kv[1]["size_bytes"])[:15]
        f.write(f"## 15 largest files\n\n")
        f.write(f"| Size kb | Lines | File |\n|---:|---:|---|\n")
        for rel, meta in biggest:
            f.write(f"| {meta['size_bytes']/1024:.0f} | {meta['lines']} | `{rel}` |\n")
        f.write("\n")

        # Top hubs (inline)
        f.write(f"## Top 10 hubs\n\n")
        f.write(f"| Inbound | File |\n|---:|---|\n")
        for rel, meta in hubs[:10]:
            if meta["inbound_count"] == 0:
                break
            f.write(f"| {meta['inbound_count']} | `{rel}` |\n")
        f.write("\n")

        # Unresolved refs (broken links)
        all_unresolved: list[tuple[str, str]] = []
        for rel, meta in manifest.items():
            for u in meta["unresolved_refs"]:
                all_unresolved.append((rel, u))
        f.write(f"## Unresolved references\n\n")
        f.write(f"References from in-scope files to paths that don't resolve to in-scope files.\n")
        f.write(f"Could be: broken links, references to code files (not .md), or out-of-scope docs.\n\n")
        f.write(f"**Total unresolved:** {len(all_unresolved)}\n\n")

        # Show sample if not too many
        if len(all_unresolved) <= 50:
            f.write(f"### All unresolved\n\n")
            for src, tgt in all_unresolved:
                f.write(f"- `{src}` → `{tgt}`\n")
        else:
            f.write(f"### Sample (first 30)\n\n")
            for src, tgt in all_unresolved[:30]:
                f.write(f"- `{src}` → `{tgt}`\n")
        f.write("\n")

    print(f"OK: scanned {len(manifest)} files")
    print(f"  - manifest: {manifest_path}")
    print(f"  - orphans:  {orphans_path}")
    print(f"  - hubs:     {hubs_path}")
    print(f"  - summary:  {summary_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
