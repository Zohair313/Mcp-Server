# Mcp-Server (`local-demo-mcp`)

A modular TypeScript MCP (Model Context Protocol) server built with `@modelcontextprotocol/sdk` over `StdioServerTransport` for inspecting GitHub repositories and serving project note resources.

## Architecture

```text
mcp-demo/
├── src/
│   ├── index.ts                  # Stdio entrypoint (logs only to stderr)
│   ├── server.ts                 # McpServer factory registering tools & resources
│   ├── types.ts                  # Shared interfaces and structured GitHubClientError
│   ├── services/
│   │   └── githubClient.ts       # GitHub Contents API client, path validation, limits, timeouts
│   ├── tools/
│   │   └── github.ts             # GitHub inspection tools
│   ├── prompts/
│   │   └── githubPrompts.ts      # Reusable MCP prompt templates (review_repo, onboard_developer)
│   └── resources/
│       └── notes.ts              # project://{topic} resource template
├── tests/
│   └── github.test.ts            # Unit & in-memory MCP integration tests
├── package.json
└── tsconfig.json
```

## Capabilities

- **Tools**:
  - `list_github_files`: Lists files and folders in a GitHub repository directory (`owner`, `repo`, optional `path`).
  - `read_github_file`: Fetches and decodes UTF-8 text files from a GitHub repository with path traversal checks, binary-file detection, 100 KB truncation guard (character-boundary safe), a clear `TOO_LARGE` error for files above GitHub's ~1 MB inline limit, and `AbortSignal.timeout` protection.
  - `get_recent_commits`: Fetches the most recent commits (`1–20`) with SHA, date, author, and commit summary.
  - `analyze_repo`: Inspects repository metadata, root files, health checks (`README`, `.gitignore`, `LICENSE`, `tests`, real CI workflows), and `package.json` tech stack. Also scans up to three likely project subdirectories (e.g. `mcp-demo`) so checks are not root-only.
- **Prompts**:
  - `review_repo`: Structured prompt to audit repository architecture, code quality, and security.
  - `onboard_developer`: Structured prompt to generate a quick developer onboarding guide.
- **Resources**:
  - `project://mcp` (`project-mcp-note`): A discoverable static note listed by `resources/list`.
  - `project://{topic}` (`project-notes`): Returns contextual notes for a given topic.

GitHub responses are cached in memory for 60 seconds with ETag revalidation and the pinned `X-GitHub-Api-Version: 2022-11-28` header to reduce rate-limit usage.

## Setup, Build & Test

```bash
cd mcp-demo
npm install
npm run build   # Compiles TypeScript from src/ to dist/
npm test        # Runs unit and integration tests via tsx --test
```

### Development & Production Run

- **Development (TypeScript directly):**
  ```bash
  npx tsx src/index.ts
  ```
- **Production (compiled JS):**
  ```bash
  npm run build && npm start
  ```

## Testing with MCP Inspector

```bash
cd mcp-demo
npx @modelcontextprotocol/inspector npx tsx src/index.ts
```

Open the printed `http://127.0.0.1:6274?MCP_INSPECTOR_API_TOKEN=...` URL in your browser, connect, and test `list_github_files`, `read_github_file`, and `project://mcp`.

## Using with AI clients

Always build first, then point the client at the compiled entrypoint (`dist/index.js`), not at `tsx`:

```bash
cd mcp-demo && npm run build
```

### OpenCode

This repository includes `opencode.jsonc`, which registers the server locally:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "local-demo-mcp": {
        "type": "local",
        "command": ["node", "E:\\MCP server\\mcp-demo\\dist\\index.js"],
        "cwd": "E:\\MCP server\\mcp-demo",
        "environment": { "GITHUB_TOKEN": "{env:GITHUB_TOKEN}" }
      }
    }
  }
}
```

Tools appear as `tools.local_demo_mcp.<name>` (Code Mode) and prompts as commands such as `/local_demo_mcp:review_repo Zohair313 Mcp-Server`. Verify with `opencode mcp list` or `/mcps`. Config changes reload automatically; no restart is needed.

### Claude Desktop

Add to `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "local-demo-mcp": {
      "command": "node",
      "args": ["E:\\MCP server\\mcp-demo\\dist\\index.js"],
      "env": { "GITHUB_TOKEN": "<optional-token>" }
    }
  }
}
```

### VS Code / Cursor

VS Code: `.vscode/mcp.json`. Cursor: `.cursor/mcp.json`.

```json
{
  "servers": {
    "local-demo-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["E:\\MCP server\\mcp-demo\\dist\\index.js"]
    }
  }
}
```

> Cursor uses the key `mcpServers` instead of `servers`.

Once connected, just ask naturally — e.g. *"Review Zohair313/Mcp-Server"* or *"Create an onboarding guide for Zohair313/Mcp-Server"* — and the agent will call the tools/prompts for you. Keep the token in an environment variable, never in committed config.

## Environment Variables

- `GITHUB_TOKEN` *(optional)*: A GitHub Personal Access Token with least-privilege read access (e.g., `public_repo` or read-only `Contents` fine-grained permission). Public repositories work without a token, but setting `GITHUB_TOKEN` increases API rate limits and enables reading private repositories.

> **Stdio Note:** Never use `console.log()` in stdio MCP servers; all diagnostic logs must go to `stderr` (`console.error()`) so JSON-RPC messages on `stdout` remain valid.
