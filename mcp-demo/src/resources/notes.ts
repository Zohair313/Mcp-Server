import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Registers project note resource templates on the provided MCP server.
 */
export function registerProjectResources(server: McpServer): void {
  server.resource(
    "project-notes",
    new ResourceTemplate("project://{topic}", { list: undefined }),
    async (uri, { topic }) => {
      const topicText = Array.isArray(topic) ? topic.join("/") : (topic ?? "general");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: `Notes for ${topicText}: MCP separates tools (actions) from resources (context).`,
          },
        ],
      };
    }
  );
}
