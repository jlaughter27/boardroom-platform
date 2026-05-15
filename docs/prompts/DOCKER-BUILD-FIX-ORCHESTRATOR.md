# DOCKER BUILD FIX ORCHESTRATOR
## Context: Railway Deployment Builds Failing

**Priority:** DEPLOY BLOCKER — both services fail at the same step
**Owner:** Claude Code (Opus) — full autonomy
**Strategy:** Deploy 3 parallel subagents to diagnose and fix, then one final verification agent

---

## SITUATION AUDIT

### What's Deployed
- **Railway Project:** "BoardRoom AI" (`eb670c37-d452-4cf2-a916-392e582a94aa`)
- **PostgreSQL:** Online, healthy, variables provisioned
- **omnimind-api service:** Configured (env vars, internal domain `omnimind-api.railway.internal`), but BUILD FAILS
- **boardroom-ai service:** Configured (env vars, public domain `boardroom-ai-production-1092.up.railway.app`), but BUILD FAILS
- **Both Dockerfiles:** Use `packages/{service}/Dockerfile` with build context at REPO ROOT (no rootDirectory set in Railway)

### The Exact Failure (BOTH services fail identically here)
```
[builder 11/13] RUN cd packages/shared && pnpm exec tsc && ls dist/index.d.ts && echo "Shared declarations verified"
ls: dist/index.d.ts: No such file or directory
ERROR: exit code: 1
```

### Root Cause Analysis
`pnpm exec tsc` in `packages/shared/` **exits code 0** (no TypeScript errors) but **produces ZERO output files** — no `dist/` directory, no `.js`, no `.d.ts`. The `ls` verification step proves the files don't exist.

This happens ONLY in Docker. Locally, `packages/shared/dist/` has all expected outputs (index.js, index.d.ts, types/*.d.ts, etc.).

### Key Config Files

**`tsconfig.base.json` (repo root):**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "moduleResolution": "node"
  }
}
```

**`packages/shared/tsconfig.json`:**
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "composite": true
  },
  "include": ["src/**/*"]
}
```

**`packages/shared/package.json` build script:** `"build": "tsc"`

**Shared package src:** `packages/shared/src/index.ts` exports from 24 type files, validation, constants, utils. All exist locally and compile fine.

### Secondary Issue: `.npmrc` Not Working
Created `.npmrc` with:
```
onlyBuiltDependencies[]=@prisma/client
onlyBuiltDependencies[]=@prisma/engines
onlyBuiltDependencies[]=prisma
onlyBuiltDependencies[]=esbuild
```
But Docker build logs STILL show: `Ignored build scripts: @prisma/client@6.19.3, @prisma/engines@6.19.3, esbuild@0.25.12, esbuild@0.27.7, prisma@6.19.3`

The prisma issue is worked around (explicit `prisma generate` step), but the `.npmrc` format may be wrong for pnpm 10.

### What's Already Been Tried
1. ❌ Using `turbo build --filter=@boardroom/omnimind-api` — shared builds via turbo (tsc exits 0) but no .d.ts files produced
2. ❌ Explicit `cd packages/shared && pnpm exec tsc` before turbo — same result: tsc exits 0, no files
3. ❌ Copying shared dist into `node_modules/@boardroom/shared/` — fails because dist is empty
4. ✅ `prisma generate` before build — WORKS, PrismaClient errors gone
5. ✅ `.npmrc` copied into Docker context — file is there, but pnpm ignores it

---

## AGENT TASKS

### Agent 1: DIAGNOSE — Why `tsc` produces no output in Docker
**Type:** Explore agent (thorough)
**Goal:** Find the EXACT reason `pnpm exec tsc` exits 0 but emits nothing in Docker

Investigate these hypotheses IN ORDER:

1. **Is the `src/` directory actually present after COPY?**
   - Check if `.dockerignore` or `.gitignore` or pnpm's publish filtering strips `src/`
   - Check `packages/shared/package.json` for `"files"` field that might restrict what gets copied
   - Look for any `.npmignore` in `packages/shared/`

2. **Does `pnpm exec tsc` resolve to the correct binary?**
   - In pnpm's isolated node_modules, `tsc` might resolve to a different location
   - TypeScript is a devDependency of shared AND root — which one does `pnpm exec` find?
   - Could `pnpm exec tsc` be running WITHOUT reading `tsconfig.json` (i.e., running with default settings and finding no files)?

3. **Is there a `tsconfig.json` resolution issue?**
   - Check if `extends: "../../tsconfig.base.json"` resolves correctly when cwd is `packages/shared/` in Docker
   - The `../../` goes up to repo root — is `tsconfig.base.json` present at `/app/tsconfig.base.json`? YES, COPY step 4 copies it.
   - But does `composite: true` combined with incremental compilation check for `.tsbuildinfo` and skip emit?

4. **Could `composite: true` + stale `.tsbuildinfo` cause tsc to skip emit?**
   - `composite` implies `incremental` which uses `.tsbuildinfo`
   - If a stale `.tsbuildinfo` exists (from local dev, copied into Docker), tsc might think nothing changed and skip emit
   - Check: is `tsconfig.tsbuildinfo` or `dist/tsconfig.tsbuildinfo` in the repo? Is it gitignored?
   - **THIS IS THE MOST LIKELY CAUSE** — if the `.tsbuildinfo` is NOT gitignored and gets copied into Docker, tsc sees it and thinks the build is up-to-date, so it produces no output

5. **Does `pnpm exec tsc` use a different tsconfig?**
   - Check if there's a root-level `tsconfig.json` (not just `tsconfig.base.json`) that tsc might pick up
   - tsc searches for `tsconfig.json` up the directory tree — could it find one at `/app/tsconfig.json`?

**Deliverable:** The exact root cause, with evidence.

### Agent 2: FIX — Repair the Docker build pipeline
**Type:** Implementation agent
**Goal:** Fix both Dockerfiles to produce successful builds

Apply fixes based on the most likely causes:

1. **If `.tsbuildinfo` is the issue:**
   - Add `RUN rm -f packages/shared/tsconfig.tsbuildinfo packages/shared/dist/tsconfig.tsbuildinfo` BEFORE `pnpm exec tsc`
   - OR add `--force` flag: `pnpm exec tsc --force`
   - OR clean before build: `rm -rf packages/shared/dist && pnpm exec tsc`

2. **If tsc resolution is the issue:**
   - Use explicit project reference: `pnpm exec tsc -p packages/shared/tsconfig.json` (from repo root)
   - OR use `tsc --build packages/shared` to use project references mode

3. **Fix the `.npmrc` format for pnpm 10:**
   - Move `onlyBuiltDependencies` to `package.json` under `"pnpm"` key:
     ```json
     "pnpm": {
       "onlyBuiltDependencies": ["@prisma/client", "@prisma/engines", "prisma", "esbuild"]
     }
     ```
   - This is the documented pnpm 10 approach

4. **Add diagnostic output to Dockerfiles:**
   - After tsc: `ls -la packages/shared/dist/ || echo "NO DIST"`
   - After tsc: `cat packages/shared/tsconfig.tsbuildinfo 2>/dev/null | head -5 || echo "NO TSBUILDINFO"`
   - KEEP these diagnostics until builds are green, then remove

5. **Update BOTH Dockerfiles:**
   - `packages/omnimind-api/Dockerfile`
   - `packages/boardroom-ai/Dockerfile`

6. **Verify the boardroom-ai Dockerfile build command:**
   - boardroom-ai's build is: `tsc -p server/tsconfig.json && vite build --config client/vite.config.ts`
   - The server tsconfig extends `../../../tsconfig.base.json` — verify this resolves to `/app/tsconfig.base.json`
   - The server tsconfig has `"references": [{ "path": "../../shared" }]`
   - Vite needs: check if `packages/boardroom-ai/client/vite.config.ts` exists and imports work

**CRITICAL RULES:**
- Never delete working code to "simplify" (CLAUDE.md rule 1)
- Keep diagnostic output in Dockerfiles for now
- Commit with descriptive message
- Do NOT modify tsconfig files or source code — only Dockerfiles and package.json

### Agent 3: VERIFY — Test the fix locally
**Type:** Verification agent
**Goal:** Simulate the Docker build locally to confirm it works before pushing

1. Run `docker build -f packages/omnimind-api/Dockerfile .` from repo root
   - If Docker isn't available, simulate the build steps manually:
     ```bash
     cd packages/shared
     rm -rf dist tsconfig.tsbuildinfo
     npx tsc
     ls dist/index.d.ts  # MUST exist
     ls dist/types/       # MUST have .d.ts files
     ```

2. Run `docker build -f packages/boardroom-ai/Dockerfile .` from repo root
   - Or simulate:
     ```bash
     cd packages/boardroom-ai
     npx tsc -p server/tsconfig.json
     ls dist/server/     # MUST have .js files
     ```

3. Check for `.tsbuildinfo` files that might be in the repo:
   ```bash
   find . -name "*.tsbuildinfo" -not -path "*/node_modules/*"
   ```
   If any exist and are NOT in `.gitignore`, add them.

4. Run `pnpm run typecheck` from repo root — should pass with 0 errors.

5. Verify `.gitignore` includes:
   - `*.tsbuildinfo`
   - `dist/` (already confirmed)

**Deliverable:** Confirmation that builds succeed locally, or the remaining errors to fix.

---

## EXECUTION ORDER

1. **Launch Agents 1, 2, and 3 in parallel**
   - Agent 1 investigates root cause
   - Agent 2 applies fixes based on most likely cause (.tsbuildinfo + .npmrc)
   - Agent 3 tests the current state locally

2. **After all 3 complete:**
   - If Agent 1 found a different root cause than .tsbuildinfo, incorporate into Agent 2's fix
   - If Agent 3 found remaining errors, fix them
   - Commit all changes
   - Push to main (Railway auto-deploys)

3. **Post-push verification:**
   - Wait 90 seconds for Railway to build
   - Check deployment status
   - If still failing, read the new build logs and iterate

---

## KEY FILE LOCATIONS
- Repo root: `/Users/Joshua/boardroom-platform` (or wherever the repo is cloned)
- OmniMind Dockerfile: `packages/omnimind-api/Dockerfile`
- BoardRoom Dockerfile: `packages/boardroom-ai/Dockerfile`
- Shared tsconfig: `packages/shared/tsconfig.json`
- Base tsconfig: `tsconfig.base.json`
- Shared source: `packages/shared/src/`
- Root package.json: `package.json` (for pnpm.onlyBuiltDependencies fix)
- .npmrc: `.npmrc` (may need deletion if moving config to package.json)
- .gitignore: `.gitignore`

## WHAT SUCCESS LOOKS LIKE
Both Docker builds complete with:
```
Shared declarations verified
```
And proceed to build their respective services without TypeScript errors.
