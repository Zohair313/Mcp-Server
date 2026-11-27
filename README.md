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
  - `read_github_file`: Fetches and decodes UTF-8 text files from a GitHub repository with path traversal checks, binary-file detection, 100 KB truncation guard, and `AbortSignal.timeout` protection.
  - `get_recent_commits`: Fetches the most recent commits (`1–20`) with SHA, date, author, and commit summary.
  - `analyze_repo`: Inspects repository metadata, root files, health checks (`README`, `.gitignore`, `LICENSE`, `tests`, `.github`), and `package.json` tech stack.
- **Prompts**:
  - `review_repo`: Structured prompt to audit repository architecture, code quality, and security.
  - `onboard_developer`: Structured prompt to generate a quick developer onboarding guide.
- **Resources**:
  - `project://{topic}` (`project-notes`): Returns contextual notes for a given topic.

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

## Environment Variables

- `GITHUB_TOKEN` *(optional)*: A GitHub Personal Access Token with least-privilege read access (e.g., `public_repo` or read-only `Contents` fine-grained permission). Public repositories work without a token, but setting `GITHUB_TOKEN` increases API rate limits and enables reading private repositories.

> **Stdio Note:** Never use `console.log()` in stdio MCP servers; all diagnostic logs must go to `stderr` (`console.error()`) so JSON-RPC messages on `stdout` remain valid.
