import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProjectResources } from "./resources/notes.js";
import { registerGitHubTools } from "./tools/github.js";
import type { GitHubClientOptions } from "./types.js";

/**
 * Creates and configures the MCP server with repository tools and resources.
 */
export function createServer(clientOptions: GitHubClientOptions = {}): McpServer {
  const server = new McpServer({
    name: "local-demo-mcp",
    version: "1.0.0",
  });

  registerGitHubTools(server, clientOptions);
  registerProjectResources(server);

  return server;
}
