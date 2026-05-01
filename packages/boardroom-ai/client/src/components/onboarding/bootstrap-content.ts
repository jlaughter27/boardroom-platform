// Content for the BootstrapStep — the MEGA_PROMPT that users paste into
// ChatGPT/Claude/whatever, and supporting copy for the UI.
//
// The prompt forces a 5-step framework: mine history → enforce specificity →
// produce 7 section briefing → emit machine-readable JSON appendix → self-check.
// The JSON block at the end of the briefing mirrors BootstrapExtractionSchema
// exactly — the docs/prompts/onboarding-bootstrap.system.md prompt parses it
// as the priority path and falls back to markdown extraction if absent.

export const MEGA_PROMPT = `You are my executive briefing generator. In the next few minutes you're going to produce a dense, concrete profile of me that I'll paste into a decision-intelligence platform called BoardRoom. BoardRoom will use this profile to fuel a team of AI advisors that challenge, stress-test, and help me execute on real decisions. The quality of the advice I get over the next 90 days depends directly on the quality of what you write here. Take it seriously.

Follow this 5-step framework in order. Do not skip steps. Do not rush.

========================================================================
STEP 1 — MINE OUR CONVERSATION HISTORY BEFORE YOU WRITE A WORD
========================================================================

Go back through every conversation you've had with me. Pull out everything you already know: my role, my industry, the people I mention by name, the projects I've been stuck on, the decisions that have been paralyzing me, the patterns in how I think, the things I've said I care about, the things I've said I'm afraid of. Use that context. Do not start from a blank page and do not ask me to repeat myself.

If you have no prior context on me, say so plainly at the top of your response, then ask me the three questions you most need answered before you can produce a useful briefing. Do not fabricate.

========================================================================
STEP 2 — ENFORCE SPECIFICITY. NEVER GENERIC.
========================================================================

Every sentence you write must pass this test: could it apply equally to any other person in a similar role? If yes, rewrite it until it could only describe me.

Examples of the bar:

❌ VAGUE (DO NOT WRITE LIKE THIS):
"Wants to grow the business."
"Cares about family."
"Worried about market conditions."
"Strong technical background."

✅ CONCRETE (WRITE LIKE THIS):
"Wants to get Acme Labs from $800K ARR to $3M ARR by Dec 2026, primarily through mid-market SaaS channel partnerships rather than direct sales."
"Has two kids under 7; weights 'am I actually present when I'm home?' heavier than any business outcome when making scheduling decisions."
"Worried specifically about the impact of the Fed's March rate decision on his commercial real estate exposure in Denver and Austin."
"Shipped Postgres at Stripe for 4 years; distrusts ORMs and considers Prisma 'fine for greenfield, dangerous for migrations.'"

Proper nouns. Dollar figures. Dates. Named people. Named projects. Named fears.

========================================================================
STEP 3 — STRUCTURED BRIEFING WITH 7 EXACT-HEADER SECTIONS
========================================================================

Emit exactly the following seven sections, in this order, using these headers verbatim. Each section is prose — 2 to 6 sentences of tight, specific content. Do not use bullet points inside the sections; save bullets for the JSON appendix.

### Role & Identity
What I do, how long I've done it, what makes my situation unusual or non-standard. Mention company/organization name if I have one.

### Goals
The 3-5 things I'm actually trying to accomplish over the next 12 months. Attach a timeline to each. Name the outcome, not the activity.

### Active Projects
What I'm currently working on that has a non-zero chance of shipping. Name each project. Describe its state (actively building, stuck at a specific point, waiting on someone, deciding whether to kill it).

### Key People
The 3-7 people whose decisions or opinions materially affect mine. Use real names. For each: their role, and the specific way they influence what I do (investor, co-founder, spouse, mentor, customer who buys a lot, team lead whose leaving would be catastrophic, etc.).

### Biggest Decision
The single most important decision I am sitting on RIGHT NOW. Not a category of decision — the exact one. What it is, what the options are, what's at stake, and why I haven't decided yet.

### Worries
What keeps me up at night, in the specific language I'd use. Not "market uncertainty" — "what happens to my Series A runway if enterprise sales cycles extend another 90 days". Multiple worries are fine. Quote me to myself if you can.

### Cognitive Patterns
How I actually think and decide. Places I consistently over-index or under-index. Biases you've watched me exhibit across our conversations. Heuristics I fall back on under time pressure. This is the section that turns a generic advisor into one that can actually catch me before I make a mistake I've made before.

========================================================================
STEP 4 — MACHINE-READABLE JSON APPENDIX (REQUIRED)
========================================================================

After the prose briefing, emit a \`---\` separator on its own line, then a single fenced JSON code block matching EXACTLY this schema. BoardRoom parses this verbatim; do not rename fields, do not add fields, do not use different enum values.

\`\`\`json
{
  "role": "specific job title / primary identity",
  "industry": "tech | ministry | healthcare | finance | education | ... (free-text, but prefer the canonical term)",
  "decisionFrequency": "daily | weekly | monthly | rarely",
  "goals": [
    {
      "title": "Outcome-oriented goal with specific target and timeline",
      "level": 0,
      "domain": "business | tech | ministry | relationships | personal"
    }
  ],
  "projects": [
    {
      "title": "Named project",
      "domain": "business | tech | ministry | relationships | personal",
      "status": "active | planning | paused"
    }
  ],
  "people": [
    {
      "name": "Real name",
      "role": "Their role",
      "relationship": "How they relate to me (co-founder, spouse, board member, mentor, direct report, etc.)"
    }
  ],
  "biggestDecision": "The single most important decision I am sitting on right now",
  "worries": "What keeps me up at night, in my voice"
}
\`\`\`

Level field values for goals:
- 0 = annual theme (this year / by end of year)
- 1 = quarterly (this quarter / next 90 days)
- 2 = monthly (this month)
- 3 = weekly (this week / urgent)

Domain and status values MUST come from the enum lists above. Do not invent new ones. If unsure, use \`personal\` for domain and \`active\` for status.

========================================================================
STEP 5 — SELF-CHECK BEFORE YOU EMIT
========================================================================

Before you send your response, re-read it and verify:

1. **Specificity check**: Does every paragraph contain at least one proper noun, dollar figure, date, or named entity? If any paragraph is pure abstraction, rewrite it.
2. **Enum check**: Every \`domain\` value in the JSON is one of: business, tech, ministry, relationships, personal. Every \`status\` is one of: active, planning, paused. Every \`level\` is an integer 0-3.
3. **No fabrication check**: Every person named, every dollar amount, every date — is it grounded in something I actually told you? If you made it up, delete it.
4. **Shape check**: The JSON appendix appears AFTER the 7 markdown sections, separated by \`---\`, fenced with \`\`\`json, and closes with \`\`\`.

========================================================================
STRICT OUTPUT CONTRACT
========================================================================

Your response must:
- Begin with \`### Role & Identity\` (no preamble, no "Here is your briefing:")
- Contain all 7 sections with the exact headers above
- End with a closing \`}\` followed by a closing \`\`\`
- Contain NO sign-off, NO "let me know if you need more", NO meta-commentary

Begin now.`;

// UI copy — used by BootstrapStep.tsx. Kept adjacent so prompt changes + UI
// copy stay in sync.

export const BOOTSTRAP_STEP_COPY = {
  title: 'Bootstrap your BoardRoom',
  subtitle:
    'Skip the 5-step wizard. Give your AI of choice one briefing prompt, paste the result back, and we populate everything at once.',
  promptSectionTitle: '1. Copy this briefing prompt',
  promptSectionHelp:
    'Paste this into ChatGPT, Claude, or any AI you already use. It produces a dense profile plus a machine-readable JSON block that BoardRoom ingests in one shot.',
  copyButton: 'Copy prompt to clipboard',
  copiedButton: 'Copied!',
  uploadSectionTitle: '2. Upload the response',
  uploadSectionHelp:
    'Drop the file your AI produced, paste the raw text, or record yourself reading it aloud.',
  fileDropLabel: 'Drop a .md, .txt, or .pdf file here, or click to choose',
  orDivider: 'OR',
  pasteLabel: 'Paste the response text directly',
  pastePlaceholder:
    'Paste the full response from your AI here — both the markdown sections and the JSON block...',
  pasteSubmit: 'Use this text',
  voiceLabel: 'Or read the briefing aloud and we\'ll transcribe it',
  skipButton: 'Skip — I\'ll fill it out manually',
};
