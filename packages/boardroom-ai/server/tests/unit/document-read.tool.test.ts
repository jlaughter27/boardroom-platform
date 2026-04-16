import { describe, it, expect } from 'vitest';
import { documentReadTool } from '../../src/tools/document-read.tool';

describe('document-read.tool', () => {
  describe('execute()', () => {
    it('returns message when memoryId is provided', async () => {
      const result = await documentReadTool.execute({ memoryId: 'mem-123' });
      expect(result).toBe('Direct memory fetch requires userId context. Use searchQuery instead.');
    });

    it('returns search message when searchQuery is provided', async () => {
      const result = await documentReadTool.execute({ searchQuery: 'hiring decision' });
      expect(result).toBe('Document search for "hiring decision" — use the memory context provided in your prompt instead. This tool is for when you need to look up specific facts not in your current context.');
    });

    it('returns prompt when neither memoryId nor searchQuery provided', async () => {
      const result = await documentReadTool.execute({});
      expect(result).toBe('Please provide either a memoryId or searchQuery.');
    });

    it('handles errors gracefully', async () => {
      // This test is mostly for coverage since the tool doesn't throw
      // but the error handling path exists
      const result = await documentReadTool.execute({});
      expect(typeof result).toBe('string');
      expect(result).toBe('Please provide either a memoryId or searchQuery.');
    });
  });

  describe('definition', () => {
    it('has correct tool definition', () => {
      const { definition } = documentReadTool;
      expect(definition.name).toBe('document_read');
      expect(definition.description).toContain('Read a stored memory or document');
      expect(definition.input_schema.type).toBe('object');
      expect(definition.input_schema.properties.memoryId).toEqual({
        type: 'string',
        description: 'ID of a specific memory to read',
      });
      expect(definition.input_schema.properties.searchQuery).toEqual({
        type: 'string',
        description: 'Search query to find relevant memories',
      });
      // Neither field is strictly required — the tool asks for "at least one"
      // at runtime — so the schema intentionally omits `required`.
      expect(definition.input_schema.required).toBeUndefined();
    });
  });
});
