#!/usr/bin/env node

const mode = process.argv[2];

if (mode === 'keygen') {
  import('./keygen').then(m => m.runKeygen());
} else if (mode === 'smoke') {
  import('./smoke').then(m => m.runSmoke());
} else if (mode === 'http') {
  const port = parseInt(process.env.PORT ?? '3334', 10);
  import('./transports/http').then(m => m.startHttpServer(port));
} else {
  // Default: stdio (for Claude Desktop, Claude Code, Cursor)
  import('./transports/stdio').then(m => m.startStdioServer());
}
