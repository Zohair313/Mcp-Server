import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import {
  analyzeGitHubRepo,
  getRecentCommits,
  listGitHubFiles,
  normalizeRepoPath,
  readGitHubFile,
  validateGitHubIdentifier,
} from "../src/services/githubClient.js";
import { GitHubClientError } from "../src/types.js";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("githubClient path and identifier validation", () => {
  it("normalizes leading/trailing slashes and backslashes", () => {
    assert.equal(normalizeRepoPath("  /mcp-demo\\src/index.ts/ "), "mcp-demo/src/index.ts");
    assert.equal(normalizeRepoPath(""), "");
  });

  it("rejects path traversal and null bytes", () => {
    assert.throws(
      () => normalizeRepoPath("../secret"),
      (err: unknown) => err instanceof GitHubClientError && err.code === "INVALID_INPUT"
    );
    assert.throws(
      () => normalizeRepoPath("src/\0index.ts"),
      (err: unknown) => err instanceof GitHubClientError && err.code === "INVALID_INPUT"
    );
  });

  it("rejects invalid owner or repo identifiers", () => {
    assert.throws(
      () => validateGitHubIdentifier("bad/owner", "owner"),
      (err: unknown) => err instanceof GitHubClientError && err.code === "INVALID_INPUT"
    );
  });
});

describe("githubClient API handling", () => {
  it("lists directory entries on success", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse([
        { name: "README.md", path: "README.md", type: "file" },
        { name: "src", path: "src", type: "dir" },
      ]);

    const items = await listGitHubFiles("Zohair313", "Mcp-Server", "", { fetchImpl });
    assert.equal(items.length, 2);
    assert.equal(items[0]?.path, "README.md");
  });

  it("reads and decodes UTF-8 file content", async () => {
    const encoded = Buffer.from("# Mcp-Server\nHello", "utf-8").toString("base64");
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        name: "README.md",
        path: "README.md",
        type: "file",
        content: encoded,
        encoding: "base64",
      });

    const result = await readGitHubFile("Zohair313", "Mcp-Server", "README.md", { fetchImpl });
    assert.equal(result.truncated, false);
    assert.equal(result.text, "# Mcp-Server\nHello");
  });

  it("returns NOT_FOUND error on 404", async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ message: "Not Found" }, 404);

    await assert.rejects(
      () => readGitHubFile("Zohair313", "Mcp-Server", "missing.txt", { fetchImpl }),
      (err: unknown) => err instanceof GitHubClientError && err.code === "NOT_FOUND" && err.status === 404
    );
  });

  it("returns RATE_LIMITED error on 403 with remaining=0", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ message: "API rate limit exceeded" }, 403, {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "1700000000",
      });

    await assert.rejects(
      () => listGitHubFiles("Zohair313", "Mcp-Server", "", { fetchImpl }),
      (err: unknown) =>
        err instanceof GitHubClientError && err.code === "RATE_LIMITED" && err.status === 403
    );
  });

  it("returns TIMEOUT error when fetch aborts on timeout", async () => {
    const fetchImpl: typeof fetch = async () => {
      const timeoutErr = new Error("The operation timed out.");
      timeoutErr.name = "TimeoutError";
      throw timeoutErr;
    };

    await assert.rejects(
      () => listGitHubFiles("Zohair313", "Mcp-Server", "", { fetchImpl, timeoutMs: 50 }),
      (err: unknown) => err instanceof GitHubClientError && err.code === "TIMEOUT"
    );
  });

  it("rejects binary files with BINARY_FILE error", async () => {
    const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]).toString("base64");
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        name: "logo.png",
        path: "logo.png",
        type: "file",
        content: binaryContent,
        encoding: "base64",
      });

    await assert.rejects(
      () => readGitHubFile("Zohair313", "Mcp-Server", "logo.png", { fetchImpl }),
      (err: unknown) => err instanceof GitHubClientError && err.code === "BINARY_FILE"
    );
  });

  it("truncates oversized UTF-8 files with a clear notice", async () => {
    const largeText = "a".repeat(200);
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        name: "large.txt",
        path: "large.txt",
        type: "file",
        content: Buffer.from(largeText, "utf-8").toString("base64"),
        encoding: "base64",
      });

    const result = await readGitHubFile("Zohair313", "Mcp-Server", "large.txt", {
      fetchImpl,
      maxFileBytes: 50,
    });
    assert.equal(result.truncated, true);
    assert.equal(result.byteLength, 200);
    assert.match(result.text, /\[Truncated: showing first 50 of 200 bytes\]/);
  });
});

describe("MCP server integration", () => {
  it("exposes GitHub tools, project-notes resource, and prompts cleanly", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/contents/missing.md")) {
        return jsonResponse({ message: "Not Found" }, 404);
      }
      if (url.includes("/commits")) {
        return jsonResponse([
          {
            sha: "abcdef1234567890",
            commit: {
              message: "feat: initial release\n\ndetails",
              author: { name: "Zohair", date: "2026-11-27T00:00:00Z" },
            },
          },
        ]);
      }
      if (url.endsWith("/repos/Zohair313/Mcp-Server")) {
        return jsonResponse({
          full_name: "Zohair313/Mcp-Server",
          description: "MCP server",
          default_branch: "main",
          language: "TypeScript",
          stargazers_count: 5,
          forks_count: 1,
          open_issues_count: 0,
        });
      }
      if (url.endsWith("/contents/package.json")) {
        return jsonResponse({
          name: "package.json",
          path: "package.json",
          type: "file",
          content: Buffer.from(
            JSON.stringify({
              scripts: { build: "tsc", test: "tsx --test" },
              dependencies: { "@modelcontextprotocol/sdk": "^1.0.0" },
              devDependencies: { typescript: "^5.0.0" },
            }),
            "utf-8"
          ).toString("base64"),
          encoding: "base64",
        });
      }
      return jsonResponse([
        { name: "README.md", path: "README.md", type: "file" },
        { name: "package.json", path: "package.json", type: "file" },
        { name: ".gitignore", path: ".gitignore", type: "file" },
      ]);
    };

    const server = createServer({ fetchImpl });
    const client = new Client({ name: "integration-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const { tools } = await client.listTools();
    const toolNames = tools.map((t) => t.name).sort();
    assert.deepEqual(toolNames, [
      "analyze_repo",
      "get_recent_commits",
      "list_github_files",
      "read_github_file",
    ]);

    const listRes = await client.callTool({
      name: "list_github_files",
      arguments: { owner: "Zohair313", repo: "Mcp-Server" },
    });
    assert.equal(listRes.isError, undefined);
    assert.match((listRes.content as Array<{ text: string }>)[0]?.text ?? "", /\[file\] README\.md/);

    const commitsRes = await client.callTool({
      name: "get_recent_commits",
      arguments: { owner: "Zohair313", repo: "Mcp-Server", limit: 1 },
    });
    assert.equal(commitsRes.isError, undefined);
    assert.match(
      (commitsRes.content as Array<{ text: string }>)[0]?.text ?? "",
      /abcdef1 \| 2026-11-27T00:00:00Z \| Zohair: feat: initial release/
    );

    const analyzeRes = await client.callTool({
      name: "analyze_repo",
      arguments: { owner: "Zohair313", repo: "Mcp-Server" },
    });
    assert.equal(analyzeRes.isError, undefined);
    const parsedAnalysis = JSON.parse(
      (analyzeRes.content as Array<{ text: string }>)[0]?.text ?? "{}"
    ) as { fullName: string; checks: { hasReadme: boolean }; dependencies: string[] };
    assert.equal(parsedAnalysis.fullName, "Zohair313/Mcp-Server");
    assert.equal(parsedAnalysis.checks.hasReadme, true);
    assert.deepEqual(parsedAnalysis.dependencies, ["@modelcontextprotocol/sdk"]);

    const errRes = await client.callTool({
      name: "read_github_file",
      arguments: { owner: "Zohair313", repo: "Mcp-Server", path: "missing.md" },
    });
    assert.equal(errRes.isError, true);
    assert.match((errRes.content as Array<{ text: string }>)[0]?.text ?? "", /\[NOT_FOUND\]/);

    const resourceRes = await client.readResource({ uri: "project://mcp" });
    assert.match(
      (resourceRes.contents[0] as { text: string }).text,
      /Notes for mcp: MCP separates tools \(actions\) from resources \(context\)\./
    );

    const { prompts } = await client.listPrompts();
    assert.deepEqual(
      prompts.map((p) => p.name).sort(),
      ["onboard_developer", "review_repo"]
    );

    const promptRes = await client.getPrompt({
      name: "review_repo",
      arguments: { owner: "Zohair313", repo: "Mcp-Server" },
    });
    assert.match(
      (promptRes.messages[0]?.content as { text: string }).text,
      /analyze_repo on Zohair313\/Mcp-Server/
    );

    await client.close();
  });

  it("getRecentCommits and analyzeGitHubRepo work directly via service functions", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/commits")) {
        return jsonResponse([
          { sha: "1234567890", commit: { message: "fix: bug", author: { name: "Dev", date: "2026-01-01" } } },
        ]);
      }
      if (url.endsWith("/repos/a/b")) {
        return jsonResponse({
          full_name: "a/b",
          description: null,
          default_branch: "main",
          language: null,
          stargazers_count: 0,
          forks_count: 0,
          open_issues_count: 0,
        });
      }
      return jsonResponse([{ name: "README.md", path: "README.md", type: "file" }]);
    };

    const commits = await getRecentCommits("a", "b", 5, { fetchImpl });
    assert.equal(commits[0]?.sha, "1234567");

    const analysis = await analyzeGitHubRepo("a", "b", { fetchImpl });
    assert.equal(analysis.checks.hasPackageJson, false);
  });
});
