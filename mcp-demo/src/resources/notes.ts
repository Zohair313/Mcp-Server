import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function noteText(topicText: string): string {
  return `Notes for ${topicText}: MCP separates tools (actions) from resources (context).`;
}

/**
 * Registers a discoverable note plus a project note template on the provided MCP server.
 */
export function registerProjectResources(server: McpServer): void {
  server.resource(
    "project-mcp-note",
    "project://mcp",
    { title: "MCP basics", description: "Note explaining tools vs. resources", mimeType: "text/plain" },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/plain", text: noteText("mcp") }],
    })
  );

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
            text: noteText(topicText),
          },
        ],
      };
    }
  );
}
