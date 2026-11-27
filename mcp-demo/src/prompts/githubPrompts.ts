import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Registers reusable MCP prompt templates for GitHub repository workflows.
 */
export function registerGitHubPrompts(server: McpServer): void {
  server.prompt(
    "review_repo",
    "Audit a GitHub repository's architecture, code quality, and security",
    {
      owner: z.string().trim().min(1).describe("GitHub username or organization"),
      repo: z.string().trim().min(1).describe("Repository name"),
    },
    ({ owner, repo }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Please review the GitHub repository ${owner}/${repo}.`,
              `1. Run analyze_repo on ${owner}/${repo} to inspect metadata, tech stack, and health checks.`,
              `2. Use list_github_files and read_github_file to inspect key source files and configuration.`,
              `3. Summarize architecture strengths, potential bugs/security risks, and concrete improvements.`,
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.prompt(
    "onboard_developer",
    "Generate a quick developer onboarding guide for a GitHub repository",
    {
      owner: z.string().trim().min(1).describe("GitHub username or organization"),
      repo: z.string().trim().min(1).describe("Repository name"),
    },
    ({ owner, repo }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Create a concise developer onboarding guide for ${owner}/${repo}.`,
              `1. Call analyze_repo and get_recent_commits for ${owner}/${repo}.`,
              `2. Read README.md and key entrypoint files using read_github_file.`,
              `3. Explain how to set up, build, test, and navigate the codebase.`,
            ].join("\n"),
          },
        },
      ],
    })
  );
}
