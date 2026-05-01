# MULTI-LEVEL BUILD AUDIT ORCHESTRATOR

> **Usage**: Paste this into Claude Code (Opus) AFTER completing all build phases.
> **Purpose**: Independent verification of the entire codebase by a fresh agent
> with no build context. This agent has never seen the code — it validates purely
> against contracts, specs, and type system.
> **Duration**: ~15-20 minutes. Read-only — makes NO code changes.

---

Read .claude/CLAUDE.md first. You are the AUDIT ORCHESTRATOR — a completely
independent verification agent. You did NOT build this code. You are here to
find every gap, every inconsistency, every broken contract, and every security
risk. Be adversarial. Assume nothing works until proven otherwise.

You will execute 7 audit levels sequentially. For each level, delegate to a
READ-ONLY subagent. The subagent MUST NOT modify any files. It reads, runs
type checks, runs tests, and REPORTS.

After all 7 levels, you produce a single AUDIT REPORT with:
- Overall grade (A-F)
- Critical issues (must fix before launch)
- Warnings (should fix, not blocking)
- Observations (nice to fix, low priority)
- Test coverage gaps
- Security findings

---

## LEVEL 1: STATIC ANALYSIS (Subagent)

Run these commands and report ALL output:

```bash
# TypeScript compilation — both services
cd packages/omnimind-api && npx tsc --noEmit 2>&1
cd packages/boardroom-ai && npx tsc --noEmit -p server/tsconfig.json 2>&1

# Prisma validation
cd packages/omnimind-api && npx prisma validate 2>&1

# Check for unused imports (basic grep)
grep -rn "import.*from" packages/*/src/ | grep -v node_modules | grep -v ".test." | head -50

# Check for console.log in production code (should use logger)
grep -rn "console\.log\|console\.error\|console\.warn" packages/*/src/ | grep -v node_modules | grep -v ".test." | grep -v "// debug"

# Check for hardcoded secrets
grep -rn "sk-\|password.*=.*['\"]" packages/*/src/ | grep -v node_modules | grep -v ".test." | grep -v ".env"

# Bundle analysis
cd packages/boardroom-ai && npx vite build --config client/vite.config.ts 2>&1 | tail -20
```

**PASS criteria:** Zero TypeScript errors. Zero Prisma errors. No hardcoded secrets.

---

## LEVEL 2: CONTRACT COMPLIANCE (Subagent — read-only)

Read both API contracts:
- `docs/contracts/omnimind-api.contract.md`
- `docs/contracts/boardroom-api.contract.md`

For EVERY endpoint in each contract, verify:
1. Route file exists
2. HTTP method + path registered
3. Request validation exists (Zod schema or manual check)
4. Response shape matches contract
5. Auth middleware applied (x-api-key for OmniMind, JWT for BoardRoom)
6. Error responses match contract error shapes

**Report format for each endpoint:**
```
[PASS/FAIL] METHOD /path — notes
```

**Also check:**
- Are there routes in the code that are NOT in the contracts? (undocumented endpoints)
- Do SSE event types match contract exactly?
- Does the OmniMind client in BoardRoom match the OmniMind contract?

---

## LEVEL 3: ARCHITECTURE COMPLIANCE (Subagent — read-only)

Verify ALL rules from .claude/CLAUDE.md:

1. **"OmniMind owns data. BoardRoom owns UX."**
   - Grep BoardRoom server for ANY Prisma import or direct DB access.
   - Should find ZERO. All data goes through OmniMind client.

2. **"All LLM outputs validated with Zod."**
   - Find every Anthropic SDK call. Check that the response is parsed with a Zod schema.
   - Check: agent.ts reason(), reasonStreaming(), reasonWithTools()
   - Check: extraction.service.ts, onboarding routes

3. **"Types live in packages/shared."**
   - Grep for `interface` and `type` declarations in omnimind-api/src and boardroom-ai/server/src.
   - Any non-trivial types defined outside shared/ are violations.

4. **"Persona prompts live in docs/prompts/*.system.md."**
   - Grep for system prompt strings in TypeScript files (hardcoded prompts).
   - Should find only file-loading code, not inline prompts.

5. **"Max 7-10 context items per persona call."**
   - Read context-packager.ts. Verify the limit is enforced.
   - Check RETRIEVAL_CONFIG.maxItemsPerPersona and maxItemsCEO.

6. **"Every memory write goes through the validation pipeline."**
   - Read memories.routes.ts POST handler. Verify it calls sync validation.
   - Check that no raw Prisma create bypasses validation.

7. **"No LangChain, no CrewAI, no LangGraph."** (ADR-001)
   - Check package.json files for these dependencies.
   - Grep for any imports.

8. **"Claude-only model provider."** (ADR-002)
   - Check for any non-Anthropic LLM SDK imports.
   - Verify MODEL_MAP only contains Claude models.

---

## LEVEL 4: UNIT + INTEGRATION TESTS (Subagent)

Run ALL test suites and report results:

```bash
# Shared package tests
cd packages/shared && npx vitest run 2>&1

# OmniMind unit tests
cd packages/omnimind-api && npx vitest run 2>&1

# BoardRoom unit tests
cd packages/boardroom-ai && npx vitest run 2>&1
```

For each test file, report:
- Total tests, passed, failed, skipped
- Any test that fails — include full error output

**Coverage gap analysis:**
List every source file that has NO corresponding test file. Categorize by risk:
- HIGH: Auth, validation pipeline, memory CRUD, agent runtime
- MEDIUM: Entity CRUD, retrieval layers, extraction
- LOW: Health endpoints, utility functions, constants

---

## LEVEL 5: DATA FLOW INTEGRITY (Subagent — read-only)

Trace 3 critical user flows end-to-end through the code:

**Flow 1: Decision Session (most complex)**
```
Client: createSession() → api.ts → POST /sessions
Server: sessions.routes.ts → orchestrator.createSession()
Client: dispatch() → api.ts streamSSE → POST /sessions/:id/dispatch
Server: sessions.routes.ts → orchestrator.dispatch()
  → For each persona:
    → omnimindClient.getContextForPersona()
    → OmniMind: context.routes.ts → context-assembler → 4 retrieval layers → ranker → packager
    → agent.reason() or reasonWithTools() → Anthropic SDK
    → PersonaResponseSchema.parse()
    → SSE events back to client
Client: synthesize() → POST /sessions/:id/synthesize
Server: orchestrator.synthesize() → CEO agent → SynthesisReportSchema.parse()
```
Verify each hop exists. Flag any missing links.

**Flow 2: Memory Creation**
```
POST /memories → memories.routes.ts
  → Schema validation (Zod)
  → Temporal validation
  → Budget enforcement
  → Prisma create
  → Response
```
Verify validation pipeline is called. Verify response matches contract.

**Flow 3: Onboarding**
```
Client: OnboardingPage → useOnboarding hook
  → Step 1: PATCH /user-profile
  → Step 2: POST /onboarding/extract-goals → Haiku → user confirms → POST /goals
  → Step 3: POST /onboarding/extract-projects → Haiku → POST /projects
  → Step 4: POST /people (direct)
  → Step 5: POST /onboarding/extract-memories → Haiku → POST /memories
  → POST /onboarding/complete → PATCH /user-profile (onboardingComplete: true)
```
Verify each API call exists. Verify extraction prompts exist.

---

## LEVEL 6: SECURITY REVIEW (Subagent — read-only)

**Authentication:**
- Is JWT secret from env var (not hardcoded)?
- Are cookies httpOnly + secure + sameSite?
- Is password hashed with bcrypt (not plain text)?
- Does logout actually clear the cookie?
- Is there CSRF protection?

**Authorization:**
- Are ALL data-reading endpoints user-scoped? (x-user-id or JWT userId)
- Can user A access user B's memories/decisions/goals?
- Is the OmniMind API key validated on every request?

**Input Validation:**
- Is EVERY POST/PATCH body validated with Zod?
- Are query params sanitized?
- Are there any raw SQL queries without parameterization?
- Max payload size limits set?

**Secrets:**
- Are API keys only in .env (never in code)?
- Is .env in .gitignore?
- Are error messages safe (no stack traces in production)?
- Are OAuth tokens encrypted at rest?

**Rate Limiting:**
- Is rate limiting applied to session creation?
- Is it applied to auth endpoints (prevent brute force)?
- Are the limits from shared constants (not hardcoded)?

---

## LEVEL 7: FRONTEND CONSISTENCY (Subagent — read-only)

**Visual consistency:**
- Do ALL pages use bg-gray-950 dark theme? (grep for bg-white or bg-gray-100)
- Do ALL pages have loading states?
- Do ALL pages have error states?
- Do ALL pages have empty states?
- Is text hierarchy consistent? (text-4xl for titles, text-lg for sections)

**State management:**
- Do ALL API calls go through lib/api.ts? (no raw fetch in components)
- Do ALL stores use Zustand? (no local React state for shared data)
- Is there any direct OmniMind URL in client code? (should be /api only)

**Routing:**
- Are ALL routes protected (redirect to /login if unauthenticated)?
- Does onboarding gate work (redirect to /onboarding if !onboardingComplete)?
- Are there any dead routes or unreachable pages?

**Type safety:**
- Are ALL entity types from @boardroom/shared? (no local redefinitions)
- Are there any `any` types? List all with justification check.
- Are SSE event types properly typed?

---

## AUDIT REPORT FORMAT

After all 7 levels, produce:

```
# BoardRoom AI — Build Audit Report
Date: [date]
Auditor: Claude Code (Opus) — Independent Verification Agent
Phases Audited: 0 through [N]

## Overall Grade: [A-F]

## Critical Issues (Must Fix)
1. [issue] — [file] — [impact]
...

## Warnings (Should Fix)
1. [issue] — [file] — [impact]
...

## Observations (Nice to Fix)
1. [issue] — [file]
...

## Test Results
- Shared: X/Y passed
- OmniMind: X/Y passed
- BoardRoom: X/Y passed
- Coverage gaps: [list HIGH-risk untested files]

## Security Findings
- [finding] — [severity]
...

## Contract Compliance
- OmniMind: X/Y endpoints verified
- BoardRoom: X/Y endpoints verified
- Mismatches: [list]

## Architecture Compliance
- CLAUDE.md rules: X/Y verified
- ADR compliance: X/Y verified
- Violations: [list]

## Recommendations
1. [most important fix]
2. ...
```

---

## EXECUTION

Begin Level 1 now. Run each level sequentially — each level's findings
may inform the next level's focus areas. Do NOT skip any level.
Do NOT modify any files. This is a READ-ONLY audit.

If any level reveals a critical issue that would prevent the application
from running at all (e.g., TypeScript won't compile), note it immediately
and continue the remaining levels.

Go.
