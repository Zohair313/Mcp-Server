import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGitHubPrompts } from "./prompts/githubPrompts.js";
import { registerProjectResources } from "./resources/notes.js";
import { registerGitHubTools } from "./tools/github.js";
import type { GitHubClientOptions } from "./types.js";

/**
 * Creates and configures the MCP server with repository tools, resources, and prompts.
 */
export function createServer(clientOptions: GitHubClientOptions = {}): McpServer {
  const server = new McpServer({
    name: "local-demo-mcp",
    version: "1.0.0",
  });

  registerGitHubTools(server, clientOptions);
  registerProjectResources(server);
  registerGitHubPrompts(server);

  return server;
}
