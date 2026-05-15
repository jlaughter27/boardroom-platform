/**
 * Persona & mode metadata for UX education surfaces.
 *
 * Single source of truth for:
 *  - "Meet Your Advisors" modal cards
 *  - PersonaCard hover tooltips
 *  - Mode picker hover tooltips
 *  - Persona-flavored "Thinking..." copy
 *  - Sample suggestion chips for the empty decision input
 *
 * Copy reflects the persona prompts under docs/prompts/*.system.md.
 * Keep it warm, direct, opinionated — never corporate.
 *
 * Audit ID: UX-#2-edu
 */
import type { PersonaId, UserMode } from '@boardroom/shared';

export interface PersonaMeta {
  /** Display name (e.g. "The Optimist") */
  name: string;
  /** Hex color for the swatch — mirrors tailwind.config persona palette */
  color: string;
  /** One-sentence elevator pitch */
  role: string;
  /** 3-bullet "what does this persona look for?" — never more than 3 */
  looksFor: readonly string[];
  /** Concrete sample question this persona would ask */
  sampleQuestion: string;
  /** Short, in-character "thinking" copy for the streaming wait state */
  thinkingCopy: string;
}

/**
 * The 7 core personas, ordered as they typically appear in the UI
 * (analysts first, CEO last as the synthesizer).
 */
export const PERSONA_META: Readonly<Record<PersonaId, PersonaMeta>> = {
  optimist: {
    name: 'The Optimist',
    color: '#22c55e',
    role: 'Finds the upside, the tailwinds, and the opportunities you missed.',
    looksFor: [
      'Resources, tools, and momentum already on your side',
      'Precedents where something similar succeeded',
      'One opportunity you have not considered',
    ],
    sampleQuestion: 'What asset do you already own that would shortcut this?',
    thinkingCopy: 'Spotting upside…',
  },
  critic: {
    name: 'The Critic',
    color: '#ef4444',
    role: 'Reads the fine print. Surfaces fragilities before they become failures.',
    looksFor: [
      'Hidden assumptions and broken dependency chains',
      'The single biggest fragility (always names it explicitly)',
      'A mitigation step paired with every risk',
    ],
    sampleQuestion: 'What is the dependency chain that has to hold for this to work?',
    thinkingCopy: 'Sharpening knives…',
  },
  alternate: {
    name: 'The Alternate',
    color: '#a855f7',
    role: 'Generates the routes you did not consider. Thinks in options, not opinions.',
    looksFor: [
      '2–3 structurally different paths to the same goal',
      'Tradeoffs, lock-in risk, and second-order effects',
      'A path you have not mentioned',
    ],
    sampleQuestion: 'What is a third path that is neither A nor B?',
    thinkingCopy: 'Mapping the unbeaten paths…',
  },
  technician: {
    name: 'The Technician',
    color: '#3b82f6',
    role: 'Pressure-tests whether the plan can actually be built with what you have.',
    looksFor: [
      'Feasibility, sequencing, and the critical path',
      'Realistic timelines with confidence intervals',
      'Integration risk where new meets old',
    ],
    sampleQuestion: 'What has to be true for the timeline you assumed?',
    thinkingCopy: 'Inspecting the wires…',
  },
  questionnaire: {
    name: 'The Questionnaire',
    color: '#eab308',
    role: 'Asks the questions that make the rest of the analysis sharper.',
    looksFor: [
      'Missing scope, constraints, and stakeholders',
      'The real question hiding under the stated one',
      'What "good" looks like in 3 and 12 months',
    ],
    sampleQuestion: 'What would change your mind?',
    thinkingCopy: 'Drafting the questions that matter…',
  },
  doer: {
    name: 'The Doer',
    color: '#f97316',
    role: 'Breaks the decision into concrete, sequenced, assignable tasks.',
    looksFor: [
      'MECE tasks with owners and effort estimates',
      'Dependency order and the critical path',
      '1–2 quick wins you can ship in the next 24 hours',
    ],
    sampleQuestion: 'What can ship in the next 24 hours with zero dependencies?',
    thinkingCopy: 'Mapping next steps…',
  },
  ceo: {
    name: 'The CEO',
    color: '#06b6d4',
    role: 'Synthesizes the advisors. Picks a side. Names the tradeoff.',
    looksFor: [
      'Where the advisors disagree and why',
      'A forced choice, not a hedge or an average',
      'Concrete next steps, not abstract advice',
    ],
    sampleQuestion: 'Given everything the advisors said, what would you actually do?',
    thinkingCopy: 'Calling the shot…',
  },
} as const;

/**
 * Display order for the "Meet Your Advisors" grid.
 * Analysts first, then question/action specialists, CEO last as synthesizer.
 */
export const PERSONA_DISPLAY_ORDER: readonly PersonaId[] = [
  'optimist',
  'critic',
  'alternate',
  'technician',
  'questionnaire',
  'doer',
  'ceo',
] as const;

export interface ModeMeta {
  /** Long-form tooltip body: persona mix + when to use this */
  tooltip: string;
}

/**
 * Tooltip copy for each user-facing mode. Mirrors `MODE_CONFIGS` in
 * packages/shared — keep these in sync if persona mixes change.
 */
export const MODE_META: Readonly<Record<UserMode, ModeMeta>> = {
  'decide': {
    tooltip: 'All four advisors weigh in, then the CEO synthesizes a recommendation. Use when the decision is real and you want the full debate.',
  },
  'stress-test': {
    tooltip: 'Critic, Alternate, and Technician run a pre-mortem. Use when you already lean a direction and want it kicked hard before you commit.',
  },
  'plan': {
    tooltip: 'Technician and Doer break the path into sequenced, assignable work. Use when the decision is made and you need an execution plan.',
  },
  'clarify': {
    tooltip: 'The Questionnaire asks the questions that sharpen your thinking. Use when the question itself is still fuzzy.',
  },
  'review': {
    tooltip: 'The Critic checks progress against past decisions. Use when you want a sober look back, not a fresh analysis.',
  },
  'quick-take': {
    tooltip: 'A single unified analysis from the CEO. Fast, cheap, no debate. Use for low-stakes calls.',
  },
};

/**
 * Sample decision questions shown as click-to-fill chips when the decision
 * input is empty. Range covers business, hiring, pricing, fundraising, and
 * focus — the everyday founder decisions.
 */
export const SAMPLE_DECISION_QUESTIONS: readonly string[] = [
  'Should I hire a co-founder or stay solo?',
  'Is this pricing too aggressive for the market?',
  'Should I take the seed round on these terms?',
  'Do I sunset this side project or recommit?',
  'Build it in-house or buy the off-the-shelf tool?',
  'Should I niche down or stay horizontal for another quarter?',
] as const;
