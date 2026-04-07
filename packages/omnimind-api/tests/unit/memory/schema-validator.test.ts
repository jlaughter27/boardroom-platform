import { describe, it, expect } from 'vitest';
import { validateMemorySchema } from '../../../src/memory/validation/schema-validator';

const validInput = {
  title: 'Test Memory',
  content: 'This is a test memory entry.',
  domain: 'business',
  sourceType: 'MANUAL',
};

describe('validateMemorySchema', () => {
  it('should pass for valid input', () => {
    const result = validateMemorySchema(validInput);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail when title is missing', () => {
    const { title, ...input } = validInput;
    const result = validateMemorySchema(input);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'title')).toBe(true);
  });

  it('should fail when content is missing', () => {
    const { content, ...input } = validInput;
    const result = validateMemorySchema(input);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'content')).toBe(true);
  });

  it('should fail when importance is out of range (1.5)', () => {
    const result = validateMemorySchema({ ...validInput, importance: 1.5 });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'importance')).toBe(true);
  });

  it('should fail for invalid enum value', () => {
    const result = validateMemorySchema({ ...validInput, sourceType: 'INVALID_SOURCE' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'sourceType')).toBe(true);
  });
});
