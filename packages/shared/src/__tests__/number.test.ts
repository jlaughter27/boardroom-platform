import { describe, it, expect } from 'vitest';
import {
  formatNumber,
  formatCurrency,
  formatPercent,
  round,
  floor,
  ceil,
  calculatePercent,
  calculatePercentChange,
  calculateValueFromPercent,
  calculateSimpleInterest,
  calculateCompoundInterest,
  calculateAverage,
  calculateMedian,
  calculateSum,
  clamp,
  isInRange,
  randomInRange,
  calculateFactorial,
  formatBytes
} from '../utils/number';

describe('number utilities', () => {
  describe('formatNumber', () => {
    it('formats number with thousands separators', () => {
      expect(formatNumber(1234567)).toBe('1,234,567');
      expect(formatNumber(1000)).toBe('1,000');
    });

    it('handles decimal numbers', () => {
      expect(formatNumber(1234.56)).toBe('1,234.56');
    });
  });

  describe('formatCurrency', () => {
    it('formats number as currency', () => {
      expect(formatCurrency(1234.56)).toBe('$1,234.56');
      expect(formatCurrency(1000, 'EUR', 'de-DE')).toContain('1.000');
    });
  });

  describe('formatPercent', () => {
    it('formats number as percentage', () => {
      expect(formatPercent(0.1567)).toBe('15.67%');
      expect(formatPercent(0.5, 0)).toBe('50%');
    });
  });

  describe('round', () => {
    it('rounds number to specified decimal places', () => {
      expect(round(123.4567, 2)).toBe(123.46);
      expect(round(123.4567, 0)).toBe(123);
      expect(round(123.5, 0)).toBe(124);
    });
  });

  describe('floor', () => {
    it('rounds number down', () => {
      expect(floor(123.4567, 2)).toBe(123.45);
      expect(floor(123.999, 0)).toBe(123);
    });
  });

  describe('ceil', () => {
    it('rounds number up', () => {
      expect(ceil(123.4567, 2)).toBe(123.46);
      expect(ceil(123.001, 0)).toBe(124);
    });
  });

  describe('calculatePercent', () => {
    it('calculates percentage of total', () => {
      expect(calculatePercent(25, 100)).toBe(0.25);
      expect(calculatePercent(0, 100)).toBe(0);
      expect(calculatePercent(100, 0)).toBe(0);
    });
  });

  describe('calculatePercentChange', () => {
    it('calculates percentage change', () => {
      expect(calculatePercentChange(100, 125)).toBe(0.25);
      expect(calculatePercentChange(100, 75)).toBe(-0.25);
      expect(calculatePercentChange(0, 100)).toBe(Infinity);
    });
  });

  describe('calculateValueFromPercent', () => {
    it('calculates value from percentage', () => {
      expect(calculateValueFromPercent(0.25, 100)).toBe(25);
      expect(calculateValueFromPercent(0.5, 200)).toBe(100);
    });
  });

  describe('calculateSimpleInterest', () => {
    it('calculates simple interest', () => {
      expect(calculateSimpleInterest(1000, 0.05, 2)).toBe(100);
      expect(calculateSimpleInterest(500, 0.1, 1)).toBe(50);
    });
  });

  describe('calculateCompoundInterest', () => {
    it('calculates compound interest', () => {
      // 1000 * (1 + 0.05/1)^(1*2) = 1000 * 1.1025 = 1102.50
      // Interest = 1102.50 - 1000 = 102.50
      expect(calculateCompoundInterest(1000, 0.05, 2)).toBeCloseTo(102.50);
    });
  });

  describe('calculateAverage', () => {
    it('calculates average of numbers', () => {
      expect(calculateAverage([1, 2, 3, 4])).toBe(2.5);
      expect(calculateAverage([])).toBe(0);
      expect(calculateAverage([5])).toBe(5);
    });
  });

  describe('calculateMedian', () => {
    it('calculates median of odd number of values', () => {
      expect(calculateMedian([1, 3, 2])).toBe(2);
      expect(calculateMedian([5, 1, 3])).toBe(3);
    });

    it('calculates median of even number of values', () => {
      expect(calculateMedian([1, 3, 2, 4])).toBe(2.5);
      expect(calculateMedian([1, 2, 3, 4, 5, 6])).toBe(3.5);
    });

    it('returns 0 for empty array', () => {
      expect(calculateMedian([])).toBe(0);
    });
  });

  describe('calculateSum', () => {
    it('calculates sum of numbers', () => {
      expect(calculateSum([1, 2, 3])).toBe(6);
      expect(calculateSum([])).toBe(0);
      expect(calculateSum([-1, 0, 1])).toBe(0);
    });
  });

  describe('clamp', () => {
    it('clamps number within range', () => {
      expect(clamp(150, 0, 100)).toBe(100);
      expect(clamp(-10, 0, 100)).toBe(0);
      expect(clamp(50, 0, 100)).toBe(50);
    });
  });

  describe('isInRange', () => {
    it('checks if number is within range', () => {
      expect(isInRange(50, 0, 100)).toBe(true);
      expect(isInRange(150, 0, 100)).toBe(false);
      expect(isInRange(-10, 0, 100)).toBe(false);
      expect(isInRange(0, 0, 100)).toBe(true);
      expect(isInRange(100, 0, 100)).toBe(true);
    });
  });

  describe('randomInRange', () => {
    it('generates random number within range', () => {
      for (let i = 0; i < 10; i++) {
        const random = randomInRange(1, 10);
        expect(random).toBeGreaterThanOrEqual(1);
        expect(random).toBeLessThanOrEqual(10);
      }
    });

    it('handles single value range', () => {
      expect(randomInRange(5, 5)).toBe(5);
    });
  });

  describe('calculateFactorial', () => {
    it('calculates factorial', () => {
      expect(calculateFactorial(5)).toBe(120);
      expect(calculateFactorial(0)).toBe(1);
      expect(calculateFactorial(1)).toBe(1);
      expect(calculateFactorial(-1)).toBeNaN();
    });
  });

  describe('formatBytes', () => {
    it('formats bytes to human-readable format', () => {
      expect(formatBytes(0)).toBe('0 Bytes');
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1024 * 1024)).toBe('1 MB');
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
    });

    it('handles decimal places', () => {
      expect(formatBytes(1500, 1)).toBe('1.5 KB');
    });
  });
});