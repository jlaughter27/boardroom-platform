import type { ToolHandler } from './tool-registry';

type MathEvaluate = (expr: string) => unknown;
let cachedEvaluate: MathEvaluate | null = null;

async function getEvaluate(): Promise<MathEvaluate> {
  if (cachedEvaluate) return cachedEvaluate;
  const mathjs = await import('mathjs');
  cachedEvaluate = mathjs.evaluate as MathEvaluate;
  return cachedEvaluate;
}

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
      const evaluate = await getEvaluate();
      const result = evaluate(input.expression as string);
      return `${input.expression} = ${result}`;
    } catch (err) {
      return `Could not evaluate "${input.expression}": ${err instanceof Error ? err.message : 'Invalid expression'}`;
    }
  },
};
