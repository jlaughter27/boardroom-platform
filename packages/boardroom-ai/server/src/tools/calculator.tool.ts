import { evaluate } from 'mathjs';
import type { ToolHandler } from './tool-registry';

export const calculatorTool: ToolHandler = {
  definition: {
    name: 'calculator',
    description: 'Evaluate mathematical expressions. Use for financial calculations, percentages, growth rates, timelines.',
    input_schema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Math expression (e.g. "29 * 1000 * 12" or "0.15 ^ 4")' },
      },
      required: ['expression'],
    },
  },
  execute: async (input) => {
    try {
      const result = evaluate(input.expression as string);
      return `${input.expression} = ${result}`;
    } catch (err) {
      return `Could not evaluate "${input.expression}": ${err instanceof Error ? err.message : 'Invalid expression'}`;
    }
  },
};
