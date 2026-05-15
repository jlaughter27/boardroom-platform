import { describe, it, expect } from 'vitest';
import type { PersonaId, UserMode } from '@boardroom/shared';
import {
  PERSONA_META,
  PERSONA_DISPLAY_ORDER,
  MODE_META,
  SAMPLE_DECISION_QUESTIONS,
} from '../../src/lib/persona-metadata';

const CORE_PERSONAS: PersonaId[] = [
  'optimist',
  'critic',
  'alternate',
  'technician',
  'questionnaire',
  'doer',
  'ceo',
];

const ALL_MODES: UserMode[] = [
  'decide',
  'stress-test',
  'plan',
  'clarify',
  'review',
  'quick-take',
];

describe('persona-metadata', () => {
  it('has metadata for all 7 core personas', () => {
    for (const id of CORE_PERSONAS) {
      expect(PERSONA_META[id], `missing meta for ${id}`).toBeDefined();
    }
  });

  it('every persona has all required fields populated', () => {
    for (const id of CORE_PERSONAS) {
      const m = PERSONA_META[id];
      expect(m.name, `${id}.name`).toMatch(/^The /);
      expect(m.color, `${id}.color`).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(m.role.length, `${id}.role`).toBeGreaterThan(20);
      expect(m.looksFor.length, `${id}.looksFor`).toBeGreaterThanOrEqual(1);
      expect(m.looksFor.length, `${id}.looksFor max 3`).toBeLessThanOrEqual(3);
      m.looksFor.forEach((b, i) => {
        expect(b.length, `${id}.looksFor[${i}]`).toBeGreaterThan(0);
      });
      expect(m.sampleQuestion.length, `${id}.sampleQuestion`).toBeGreaterThan(10);
      expect(m.thinkingCopy.length, `${id}.thinkingCopy`).toBeGreaterThan(0);
    }
  });

  it('display order contains all 7 core personas exactly once', () => {
    expect(PERSONA_DISPLAY_ORDER).toHaveLength(CORE_PERSONAS.length);
    for (const id of CORE_PERSONAS) {
      expect(PERSONA_DISPLAY_ORDER).toContain(id);
    }
    const unique = new Set(PERSONA_DISPLAY_ORDER);
    expect(unique.size).toBe(PERSONA_DISPLAY_ORDER.length);
  });

  it('has tooltip metadata for every UserMode', () => {
    for (const m of ALL_MODES) {
      expect(MODE_META[m], `missing mode meta for ${m}`).toBeDefined();
      expect(MODE_META[m].tooltip.length).toBeGreaterThan(30);
    }
  });

  it('exposes between 4 and 6 sample decision questions', () => {
    expect(SAMPLE_DECISION_QUESTIONS.length).toBeGreaterThanOrEqual(4);
    expect(SAMPLE_DECISION_QUESTIONS.length).toBeLessThanOrEqual(6);
    SAMPLE_DECISION_QUESTIONS.forEach((q, i) => {
      expect(q.endsWith('?'), `Q${i} must end with '?'`).toBe(true);
    });
  });
});
