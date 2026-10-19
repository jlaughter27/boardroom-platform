#!/usr/bin/env node

const mode = process.argv[2];

if (mode === 'keygen') {
  import('./keygen').then(m => m.runKeygen());
} else if (mode === 'smoke') {
  import('./smoke').then(m => m.runSmoke());
} else if (mode === 'bench') {
  import('./bench').then(m => m.runBenchCli());
} else if (mode === 'http') {
  import('./transports/http').then(m => {
    // L-10 — a bad PORT used to reach listen(NaN), throw inside the async
    // start, be swallowed by the process handlers and leave a live process
    // that listens on nothing until the healthcheck restarted it.
    const port = m.parsePort(process.env.PORT);
    if (port === undefined) {
      console.error(`[omnimind-mcp] PORT must be an integer between 1 and 65535 (got ${JSON.stringify(process.env.PORT)})`);
      process.exit(1);
    }
    return m.startHttpServer(port);
  });
} else {
  // Default: stdio (for Claude Desktop, Claude Code, Cursor)
  import('./transports/stdio').then(m => m.startStdioServer());
}
