import { describe, it, expect } from 'vitest';
import {
  generateSlug,
  truncate,
  toCamelCase,
  toPascalCase,
  toKebabCase,
  toSnakeCase,
  capitalize,
  titleCase,
  removeWhitespace,
  normalizeWhitespace,
  isAlpha,
  isAlphaNumeric,
  isNumeric,
  generateRandomString,
  maskString,
  isValidUuid,
  countWords
} from '../utils/string';

describe('string utilities', () => {
  describe('generateSlug', () => {
    it('converts text to URL-friendly slug', () => {
      expect(generateSlug('Hello World!')).toBe('hello-world');
    });
  });

  describe('truncate', () => {
    it('truncates text longer than max length', () => {
      expect(truncate('Hello World', 8)).toBe('Hello...');
    });
  });

  describe('toCamelCase', () => {
    it('converts to camelCase', () => {
      expect(toCamelCase('hello_world')).toBe('helloWorld');
    });
  });

  describe('toPascalCase', () => {
    it('converts to PascalCase', () => {
      expect(toPascalCase('hello_world')).toBe('HelloWorld');
    });
  });

  describe('toKebabCase', () => {
    it('converts to kebab-case', () => {
      expect(toKebabCase('helloWorld')).toBe('hello-world');
    });
  });

  describe('toSnakeCase', () => {
    it('converts to snake_case', () => {
      expect(toSnakeCase('helloWorld')).toBe('hello_world');
    });
  });

  describe('capitalize', () => {
    it('capitalizes first letter', () => {
      expect(capitalize('hello')).toBe('Hello');
    });
  });

  describe('titleCase', () => {
    it('capitalizes first letter of each word', () => {
      expect(titleCase('hello world')).toBe('Hello World');
    });
  });

  describe('removeWhitespace', () => {
    it('removes all whitespace', () => {
      expect(removeWhitespace('hello world')).toBe('helloworld');
    });
  });

  describe('normalizeWhitespace', () => {
    it('normalizes multiple spaces to single space', () => {
      expect(normalizeWhitespace('hello   world')).toBe('hello world');
    });
  });

  describe('isAlpha', () => {
    it('checks if string contains only letters', () => {
      expect(isAlpha('Hello')).toBe(true);
      expect(isAlpha('Hello123')).toBe(false);
    });
  });

  describe('isAlphaNumeric', () => {
    it('checks if string contains only letters and numbers', () => {
      expect(isAlphaNumeric('Hello123')).toBe(true);
      expect(isAlphaNumeric('Hello World')).toBe(false);
    });
  });

  describe('isNumeric', () => {
    it('checks if string contains only numbers', () => {
      expect(isNumeric('123')).toBe(true);
      expect(isNumeric('123abc')).toBe(false);
    });
  });

  describe('generateRandomString', () => {
    it('generates random string of specified length', () => {
      const random = generateRandomString(10);
      expect(random).toHaveLength(10);
      expect(random).toMatch(/^[A-Za-z0-9]+$/);
    });
  });

  describe('maskString', () => {
    it('masks sensitive information', () => {
      // 'test@example.com' length is 16, visibleChars=3
      // start: 'tes' (3), end: 'com' (3), middle: '*' * (16 - 3*2) = '*' * 10
      expect(maskString('test@example.com', 3)).toBe('tes**********com');
    });
  });

  describe('isValidUuid', () => {
    it('validates UUID format', () => {
      expect(isValidUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
      expect(isValidUuid('invalid')).toBe(false);
    });
  });

  describe('countWords', () => {
    it('counts words in a string', () => {
      expect(countWords('Hello world')).toBe(2);
    });
  });
});