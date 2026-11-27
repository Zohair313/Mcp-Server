import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "local-demo-mcp",
  version: "1.0.0",
});

type GitHubContentItem = {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  content?: string;
  encoding?: string;
};

async function fetchGitHubContents(owner: string, repo: string, path = "") {
  const cleanPath = path.replace(/^\/+/, "");
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${cleanPath}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "local-demo-mcp",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status}: ${body}`);
  }
  return (await res.json()) as GitHubContentItem | GitHubContentItem[];
}

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

server.tool(
  "multiply_numbers",
  "Multiply two numbers together",
  {
    a: z.number(),
    b: z.number(),
  },
  async ({ a, b }) => ({
    content: [{ type: "text", text: String(a * b) }],
  })
);

server.tool(
  "list_github_files",
  "List files and folders in a GitHub repository directory",
  {
    owner: z.string().describe("GitHub username or organization, e.g. Zohair313"),
    repo: z.string().describe("Repository name, e.g. Mcp-Server"),
    path: z.string().optional().default("").describe("Optional folder path inside repo"),
  },
  async ({ owner, repo, path }) => {
    try {
      const data = await fetchGitHubContents(owner, repo, path);
      const items = Array.isArray(data) ? data : [data];
      const summary = items.map((item) => `[${item.type}] ${item.path}`).join("\n");
      return { content: [{ type: "text", text: summary || "(empty directory)" }] };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      };
    }
  }
);

server.tool(
  "read_github_file",
  "Read the UTF-8 text contents of a file from a GitHub repository",
  {
    owner: z.string().describe("GitHub username or organization, e.g. Zohair313"),
    repo: z.string().describe("Repository name, e.g. Mcp-Server"),
    path: z.string().describe("File path inside repo, e.g. README.md"),
  },
  async ({ owner, repo, path }) => {
    try {
      const data = await fetchGitHubContents(owner, repo, path);
      if (Array.isArray(data) || data.type !== "file" || !data.content) {
        return {
          isError: true,
          content: [{ type: "text", text: `Path "${path}" is not a readable file.` }],
        };
      }
      const decoded = Buffer.from(data.content, "base64").toString("utf-8");
      return { content: [{ type: "text", text: decoded }] };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      };
    }
  }
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
