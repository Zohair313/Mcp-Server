import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listGitHubFiles, readGitHubFile } from "../services/githubClient.js";
import { GitHubClientError, type GitHubClientOptions } from "../types.js";

function formatToolError(error: unknown) {
  if (error instanceof GitHubClientError) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: `[${error.code}] ${error.message}` }],
    };
  }

  console.error("Unexpected error in GitHub tool:", error);
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: "Unexpected error while executing GitHub tool. Check server stderr logs for details.",
      },
    ],
  };
}

/**
 * Registers GitHub repository inspection tools on the provided MCP server.
 */
export function registerGitHubTools(
  server: McpServer,
  clientOptions: GitHubClientOptions = {}
): void {
  server.tool(
    "list_github_files",
    "List files and folders in a GitHub repository directory",
    {
      owner: z.string().trim().min(1).describe("GitHub username or organization, e.g. Zohair313"),
      repo: z.string().trim().min(1).describe("Repository name, e.g. Mcp-Server"),
      path: z
        .string()
        .optional()
        .default("")
        .describe("Optional folder path inside the repository"),
    },
    async ({ owner, repo, path }) => {
      try {
        const items = await listGitHubFiles(owner, repo, path, clientOptions);
        const summary = items.map((item) => `[${item.type}] ${item.path}`).join("\n");
        return {
          content: [{ type: "text", text: summary || "(empty directory)" }],
        };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );

  server.tool(
    "read_github_file",
    "Read the UTF-8 text contents of a file from a GitHub repository",
    {
      owner: z.string().trim().min(1).describe("GitHub username or organization, e.g. Zohair313"),
      repo: z.string().trim().min(1).describe("Repository name, e.g. Mcp-Server"),
      path: z.string().trim().min(1).describe("File path inside the repository, e.g. README.md"),
    },
    async ({ owner, repo, path }) => {
      try {
        const result = await readGitHubFile(owner, repo, path, clientOptions);
        return {
          content: [{ type: "text", text: result.text }],
        };
      } catch (error) {
        return formatToolError(error);
      }
    }
  );
}
