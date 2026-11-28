#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runInteractiveSetup } from "./cli/init.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const forceSetup = args.includes("init") || args.includes("--setup");
  const forceStdio = args.includes("--stdio");

  if (forceSetup || (process.stdin.isTTY && !forceStdio)) {
    const action = await runInteractiveSetup();
    if (action !== "start_server") {
      return;
    }
    // readline.close() pauses process.stdin; resume it so StdioServerTransport stays alive.
    process.stdin.resume();
  }

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("local-demo-mcp server connected via stdio");
}

main().catch((error) => {
  console.error("Fatal error starting MCP server:", error);
  process.exit(1);
});
