import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import {
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
  it("exposes only GitHub tools + project-notes resource and handles tool errors cleanly", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/contents/missing.md")) {
        return jsonResponse({ message: "Not Found" }, 404);
      }
      return jsonResponse([
        { name: "README.md", path: "README.md", type: "file" },
      ]);
    };

    const server = createServer({ fetchImpl });
    const client = new Client({ name: "integration-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const { tools } = await client.listTools();
    const toolNames = tools.map((t) => t.name).sort();
    assert.deepEqual(toolNames, ["list_github_files", "read_github_file"]);

    const listRes = await client.callTool({
      name: "list_github_files",
      arguments: { owner: "Zohair313", repo: "Mcp-Server" },
    });
    assert.equal(listRes.isError, undefined);
    assert.deepEqual(listRes.content, [{ type: "text", text: "[file] README.md" }]);

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

    await client.close();
  });
});
