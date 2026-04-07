import { describe, it, expect } from 'vitest';
import { calculatorTool } from '../../src/tools/calculator.tool';

describe('calculator-tool', () => {
  it('evaluates simple expression (2 + 2 = 4)', async () => {
    const result = await calculatorTool.execute({ expression: '2 + 2' });
    expect(result).toBe('2 + 2 = 4');
  });

  it('evaluates complex expression (29 * 1000 * 12)', async () => {
    const result = await calculatorTool.execute({ expression: '29 * 1000 * 12' });
    expect(result).toBe('29 * 1000 * 12 = 348000');
  });

  it('handles invalid expression gracefully', async () => {
    const result = await calculatorTool.execute({ expression: 'not a math expression +++' });
    expect(result).toMatch(/Could not evaluate/);
  });
});
