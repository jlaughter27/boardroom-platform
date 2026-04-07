import { toolRegistry } from './tool-registry';
import { webSearchTool } from './web-search.tool';
import { calculatorTool } from './calculator.tool';
import { documentReadTool } from './document-read.tool';

// Register all tools
toolRegistry.register(webSearchTool);
toolRegistry.register(calculatorTool);
toolRegistry.register(documentReadTool);

export { toolRegistry };
export type { AnthropicToolDef, ToolHandler } from './tool-registry';
