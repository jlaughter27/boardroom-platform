import type { ToolHandler } from './tool-registry';
import { TOOL_LIMITS } from '@boardroom/shared';

const SERPER_API_KEY = process.env.SERPER_API_KEY;

export const webSearchTool: ToolHandler = {
  definition: {
    name: 'web_search',
    description: 'Search the web for current information. Use when you need recent data, competitor analysis, market trends, or facts you are unsure about.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        numResults: { type: 'number', description: 'Number of results (default 5)' },
      },
      required: ['query'],
    },
  },
  execute: async (input) => {
    if (!SERPER_API_KEY) return 'Web search not configured. Proceeding without web data.';

    const numResults = Math.min((input.numResults as number) ?? 5, TOOL_LIMITS.searchResultsLimit);
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: input.query as string, num: numResults }),
    });

    if (!res.ok) return `Search failed: ${res.status}`;

    const data = await res.json() as { organic?: { title: string; snippet: string; link: string }[] };
    if (!data.organic?.length) return 'No results found.';

    return data.organic.slice(0, numResults).map((r, i) =>
      `${i + 1}. ${r.title}\n   ${r.snippet}\n   ${r.link}`
    ).join('\n\n');
  },
};
