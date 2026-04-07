import { describe, it, expect } from 'vitest';
import { getPersonasForMode, shouldIncludeCEO, isPreMortemMode } from '../../src/personas/mode-router';

describe('mode-router', () => {
  describe('getPersonasForMode', () => {
    it('decide mode returns optimist, critic, alternate, technician', () => {
      const personas = getPersonasForMode('decide');
      expect(personas).toEqual(['optimist', 'critic', 'alternate', 'technician']);
    });

    it('stress-test mode returns critic, alternate, technician', () => {
      const personas = getPersonasForMode('stress-test');
      expect(personas).toEqual(['critic', 'alternate', 'technician']);
    });

    it('quick-take returns empty personas array', () => {
      const personas = getPersonasForMode('quick-take');
      expect(personas).toEqual([]);
    });

    it('plan mode returns technician, doer', () => {
      const personas = getPersonasForMode('plan');
      expect(personas).toEqual(['technician', 'doer']);
    });

    it('clarify mode returns questionnaire', () => {
      const personas = getPersonasForMode('clarify');
      expect(personas).toEqual(['questionnaire']);
    });
  });

  describe('shouldIncludeCEO', () => {
    it('returns true for decide', () => {
      expect(shouldIncludeCEO('decide')).toBe(true);
    });

    it('returns false for clarify', () => {
      expect(shouldIncludeCEO('clarify')).toBe(false);
    });

    it('returns true for stress-test', () => {
      expect(shouldIncludeCEO('stress-test')).toBe(true);
    });
  });

  describe('isPreMortemMode', () => {
    it('returns true for stress-test', () => {
      expect(isPreMortemMode('stress-test')).toBe(true);
    });

    it('returns false for decide', () => {
      expect(isPreMortemMode('decide')).toBe(false);
    });

    it('returns false for plan', () => {
      expect(isPreMortemMode('plan')).toBe(false);
    });
  });
});
