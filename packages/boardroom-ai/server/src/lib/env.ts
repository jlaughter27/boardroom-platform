import { validateEnv } from '@boardroom/shared/node';

export function validateBoardRoomEnv(): void {
  validateEnv([
    { name: 'JWT_SECRET', required: true, description: 'Secret for JWT signing' },
    { name: 'OMNIMIND_API_KEY', required: true, description: 'API key for OmniMind service' },
    { name: 'OMNIMIND_API_URL', required: true, description: 'URL of OmniMind API service' },
    { name: 'ANTHROPIC_API_KEY', required: true, description: 'Anthropic API key for Claude' },
    // Lane C — Settings → Connected AI tools. Optional: without them the panel
    // still works but shows a placeholder MCP URL in the install snippets.
    { name: 'OMNIMIND_MCP_PUBLIC_URL', required: false, description: 'Public Streamable-HTTP URL of the OmniMind MCP server (e.g. https://omnimind-mcp-production.up.railway.app/mcp), shown in install snippets' },
    { name: 'APP_PUBLIC_URL', required: false, description: 'Public URL of this BoardRoom app (defaults to the request origin); used by /mcp/tokens/connect-info' },
  ]);
}
