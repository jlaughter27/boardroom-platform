#!/usr/bin/env bash
# Step B — Finish what the sandbox couldn't do.
# Run from /Users/Joshua/boardroom-platform.
#
# Does, in order:
#   1. Closes stalled PR #1 and PR #4
#   2. Deletes stale remote branches
#   3. Removes 14 git worktrees + 13 local worktree-agent-* branches + 4 claude/* branches
#   4. Syncs local main with origin (drops the orphan 1-ahead docs commit; reflog keeps it)
#   5. Saves your uncommitted prompt-loader work to a new feature branch
#   6. Smokes production (health + Phase 5 endpoints + ministry refusal)
#
# Requires:
#   - gh CLI installed and authenticated (gh auth status)
#   - You're at /Users/Joshua/boardroom-platform
#   - Railway env vars accessible (only needed for the smoke step's auth'd calls)
#
# Safety:
#   - Drops the 1-ahead commit `2bae6d3` (its files were moved by docs migration; reflog keeps it 90 days)
#   - Your uncommitted prompt-loader work goes to `feat/prompt-loader-includes` branch (not lost)
#   - .claude/CLAUDE.md will likely conflict on stash pop — you handle that by hand at the end

set -u
cd "$(dirname "$0")/.." || { echo "❌ Run from boardroom-platform repo"; exit 1; }

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $1"; }
note() { echo -e "${BLUE}ℹ${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }

echo "════════════════════════════════════════════════════════════════"
echo "  Step B Finisher — boardroom-platform"
echo "  $(date +'%Y-%m-%d %H:%M:%S')"
echo "════════════════════════════════════════════════════════════════"
echo ""

# ──────────────────────────────────────────────────────────────────
# Preflight
# ──────────────────────────────────────────────────────────────────
echo "── PREFLIGHT ─────────────────────────────────────────────────"
command -v gh >/dev/null 2>&1 || { fail "gh CLI not installed. brew install gh"; exit 1; }
gh auth status >/dev/null 2>&1 || { fail "gh not authenticated. Run: gh auth login"; exit 1; }
ok "gh CLI ready"

git fetch origin --prune
ok "fetched origin"

BEHIND=$(git rev-list --count main..origin/main 2>/dev/null || echo "?")
AHEAD=$(git rev-list --count origin/main..main 2>/dev/null || echo "?")
note "local main: $AHEAD ahead, $BEHIND behind origin/main"
echo ""

# ──────────────────────────────────────────────────────────────────
# 1 — Close stalled PRs
# ──────────────────────────────────────────────────────────────────
echo "── 1/6  CLOSE STALLED PRs ────────────────────────────────────"
for pr in 1 4; do
  STATE=$(gh pr view "$pr" --json state -q .state 2>/dev/null || echo "MISSING")
  if [[ "$STATE" == "OPEN" ]]; then
    case "$pr" in
      1) MSG="Closing — superseded by the 29 security fixes that shipped via PR #5 (commit a210a3a) and the Phase 4 audit remediation in commit f0d4cf1." ;;
      4) MSG="Closing — Phase D docs migration shipped via commit 24a2187. This draft is for that work which has merged differently." ;;
    esac
    gh pr close "$pr" --comment "$MSG" && ok "Closed PR #$pr" || warn "Couldn't close PR #$pr (already closed?)"
  else
    note "PR #$pr already $STATE"
  fi
done
echo ""

# ──────────────────────────────────────────────────────────────────
# 2 — Delete stale remote branches
# ──────────────────────────────────────────────────────────────────
echo "── 2/6  DELETE STALE REMOTE BRANCHES ─────────────────────────"
REMOTE_BRANCHES=(
  claude/audit-omnimind-memory-vCsqJ
  chore/docs-phase-D-migration
  fix/security-phase-0.25
  claude/distracted-satoshi
  claude/build-memory-layer-IftGo
  claude/fix-memory-layer-production-qdmH8
)
for b in "${REMOTE_BRANCHES[@]}"; do
  if git ls-remote --exit-code --heads origin "$b" >/dev/null 2>&1; then
    git push origin --delete "$b" >/dev/null 2>&1 && ok "deleted origin/$b" || warn "couldn't delete origin/$b"
  else
    note "origin/$b already gone"
  fi
done
echo ""

# ──────────────────────────────────────────────────────────────────
# 3 — Remove git worktrees + clean local branches
# ──────────────────────────────────────────────────────────────────
echo "── 3/6  REMOVE WORKTREES + LOCAL BRANCHES ────────────────────"

# Clear any stale lock files
rm -f .git/packed-refs.lock .git/index.lock 2>/dev/null && ok "cleared git locks" || true

# Remove each non-main worktree
WORKTREES=$(git worktree list --porcelain | awk '/^worktree / {print $2}' | tail -n +2)
if [[ -n "$WORKTREES" ]]; then
  echo "$WORKTREES" | while read -r wt; do
    if [[ -n "$wt" ]]; then
      git worktree remove "$wt" --force 2>&1 | head -2 && ok "removed worktree: $wt" || warn "couldn't remove worktree: $wt"
    fi
  done
else
  note "no extra worktrees"
fi
git worktree prune
ok "pruned worktree refs"

# Also remove the .claude/worktrees/ directory if it exists (orphaned filesystem state)
if [[ -d .claude/worktrees ]]; then
  rm -rf .claude/worktrees && ok "removed .claude/worktrees/ directory" || warn "couldn't remove .claude/worktrees/"
fi

# Now delete the branches
LOCAL_BRANCHES=(
  worktree-agent-a25e65ec worktree-agent-a39bf9b6 worktree-agent-a5a6bf92
  worktree-agent-a6933ad1 worktree-agent-a6f6c7af worktree-agent-a807326c
  worktree-agent-a97b079b worktree-agent-ab941044 worktree-agent-abe120bc
  worktree-agent-ad63405e worktree-agent-adc755bf worktree-agent-ae32bed3
  worktree-agent-ae71b964
  claude/affectionate-banzai claude/distracted-satoshi claude/goofy-sammet claude/quizzical-hopper
)
for b in "${LOCAL_BRANCHES[@]}"; do
  if git show-ref --verify --quiet "refs/heads/$b"; then
    git branch -D "$b" >/dev/null 2>&1 && ok "deleted local $b" || warn "couldn't delete $b"
  fi
done
echo ""

# ──────────────────────────────────────────────────────────────────
# 4 — Sync local main with origin (drop orphan 1-ahead commit)
# ──────────────────────────────────────────────────────────────────
echo "── 4/6  SYNC LOCAL MAIN ──────────────────────────────────────"

# Save the orphan commit's SHA to the reflog message for findability
ORPHAN=$(git rev-parse main 2>/dev/null)
note "orphan main commit (preserved in reflog 90 days): $ORPHAN"

# Stash uncommitted modified files (untracked stays in place)
if git diff --quiet && git diff --staged --quiet; then
  note "no modified files to stash"
  STASHED=0
else
  git stash push -m "step-b-finish auto-stash $(date +%s)" >/dev/null
  ok "stashed modified files"
  STASHED=1
fi

# Reset main to origin
git fetch origin main >/dev/null 2>&1
git reset --hard origin/main >/dev/null
ok "main reset to origin/main ($(git rev-parse --short main))"

# Restore the stash if there was one
if [[ "$STASHED" -eq 1 ]]; then
  if git stash pop >/dev/null 2>&1; then
    ok "stash popped cleanly"
  else
    warn "stash pop had conflicts — handle .claude/CLAUDE.md by hand below"
    warn "your changes are in: git stash list  (named 'step-b-finish auto-stash …')"
  fi
fi

# Move the prompt-loader work to its own feature branch
if ! git diff --quiet packages/boardroom-ai/server/src/lib/prompt-loader.ts 2>/dev/null; then
  CURRENT_BRANCH=$(git branch --show-current)
  note "Found uncommitted prompt-loader changes — moving to feature branch"
  git checkout -b feat/prompt-loader-includes 2>/dev/null || git checkout feat/prompt-loader-includes
  ok "on branch feat/prompt-loader-includes"
  note "Review the diff and commit by hand:"
  echo "    git diff"
  echo "    git add packages/boardroom-ai/server/src/lib/prompt-loader.ts packages/boardroom-ai/server/src/index.ts"
  echo "    git commit -m 'feat(prompt-loader): {{include:path}} token resolution'"
  echo "    git push origin feat/prompt-loader-includes"
  echo "    gh pr create --base main --head feat/prompt-loader-includes --title '...'"
  echo ""
  note "Switching back to main for the smoke test"
  git checkout "$CURRENT_BRANCH" 2>/dev/null || git checkout main
fi

echo ""

# ──────────────────────────────────────────────────────────────────
# 5 — Final branch inventory
# ──────────────────────────────────────────────────────────────────
echo "── 5/6  FINAL INVENTORY ──────────────────────────────────────"
echo "Local branches:"
git branch | sed 's/^/    /'
echo ""
echo "Remote branches:"
git branch -r | grep -v 'HEAD' | sed 's/^/    /'
echo ""
ok "branch state clean"
echo ""

# ──────────────────────────────────────────────────────────────────
# 6 — Production smoke
# ──────────────────────────────────────────────────────────────────
echo "── 6/6  PRODUCTION SMOKE ─────────────────────────────────────"

# 6a — public health checks (no auth)
echo "Health checks (no auth):"
H1=$(curl -s --max-time 10 https://omnimind-api-production.up.railway.app/health 2>&1)
echo "    omnimind-api:   $H1"
H2=$(curl -s --max-time 10 https://boardroom-ai-production-1092.up.railway.app/health 2>&1)
echo "    boardroom-ai:   $H2"

if echo "$H1" | grep -q '"status":"ok"' && echo "$H2" | grep -q '"status":"ok"'; then
  ok "both services healthy"
else
  fail "one or both services unhealthy — check Railway logs"
fi
echo ""

# 6b — endpoint existence (without auth, 401 = exists)
echo "Phase 5 endpoint reachability (401 = endpoint exists, auth required):"
for path in "/admin/duplicates" "/admin/stats" "/memories"; do
  CODE=$(curl -s --max-time 5 -o /dev/null -w "%{http_code}" "https://omnimind-api-production.up.railway.app$path")
  echo "    $path → HTTP $CODE"
done
echo ""

# 6c — Optional: full auth'd smoke if you export keys
if [[ -n "${OMNIMIND_API_KEY:-}" && -n "${OMNIMIND_USER_ID:-}" ]]; then
  note "Running authenticated smoke tests"

  echo "Ministry refusal test:"
  RESP=$(curl -s -X POST \
    -H "x-api-key: $OMNIMIND_API_KEY" \
    -H "x-user-id: $OMNIMIND_USER_ID" \
    -H "content-type: application/json" \
    -d '{"title":"smoke","content":"smoke","domain":"ministry"}' \
    https://omnimind-api-production.up.railway.app/memories 2>&1)
  if echo "$RESP" | grep -q "MINISTRY_DEFERRED"; then
    ok "ministry refusal works"
  else
    fail "ministry refusal NOT firing — response: $RESP"
  fi

  echo "Admin duplicates endpoint:"
  COUNT=$(curl -s -H "x-api-key: $OMNIMIND_API_KEY" \
    https://omnimind-api-production.up.railway.app/admin/duplicates 2>&1 \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('pairs',[])))" 2>/dev/null || echo "?")
  ok "/admin/duplicates returns $COUNT pair(s)"
else
  warn "OMNIMIND_API_KEY + OMNIMIND_USER_ID not set — skipping auth'd smoke"
  note "Run with auth:"
  echo "    export OMNIMIND_API_KEY=<from Railway env>"
  echo "    export OMNIMIND_USER_ID=<your user id>"
  echo "    $0"
fi
echo ""

# ──────────────────────────────────────────────────────────────────
# Done
# ──────────────────────────────────────────────────────────────────
echo "════════════════════════════════════════════════════════════════"
ok "Step B complete"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "What's left for you to do by hand:"
echo "  1. If stash conflict on .claude/CLAUDE.md — diff and merge by hand"
echo "  2. If feat/prompt-loader-includes branch exists — commit + push + PR it"
echo "  3. Begin Milestone E from MASTER-PROMPT-SOLO-GO-LIVE.md:"
echo "       - Generate 4 prod agent keys against live OmniMind"
echo "       - Paste configs into Claude Desktop / Code / Cursor / ChatGPT"
echo "       - Verify dogfooding works"
echo ""
echo "Your repo is clean and prod is verified live."
