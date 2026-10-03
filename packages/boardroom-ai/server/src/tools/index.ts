import { toolRegistry } from './tool-registry';
import { webSearchTool } from './web-search.tool';
import { calculatorTool } from './calculator.tool';
// B-114 — `document_read` is still a stub (no userId context, no OmniMind
// lookup). It is NOT registered, so it is never advertised to personas even
// though TOOL_PERMISSIONS (shared) still lists it. Re-add the register() call
// once document-read.tool.ts is implemented.
// import { documentReadTool } from './document-read.tool';

// Register all tools
toolRegistry.register(webSearchTool);
toolRegistry.register(calculatorTool);

export { toolRegistry };
export type { AnthropicToolDef, ToolHandler } from './tool-registry';
