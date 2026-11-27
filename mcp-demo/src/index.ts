import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "local-demo-mcp",
  version: "1.0.0",
});

server.tool(
  "add_numbers",
  "Add two numbers together",
  {
    a: z.number(),
    b: z.number(),
  },
  async ({ a, b }) => ({
    content: [{ type: "text", text: String(a + b) }],
  })
);

server.resource(
  "project-notes",
  new ResourceTemplate("project://{topic}", { list: undefined }),
  async (uri, { topic }) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/plain",
        text: `Notes for ${topic}: MCP separates tools (actions) from resources (context).`,
      },
    ],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
