import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  getClientTargets,
  mergeMcpConfig,
  stripJsonComments,
} from "../src/cli/init.js";

describe("interactive CLI config helpers", () => {
  it("strips JSONC comments while preserving URLs inside strings", () => {
    const raw = `{
      // line comment
      "$schema": "https://opencode.ai/config.json",
      /* block comment */
      "mcp": {}
    }`;
    const parsed = JSON.parse(stripJsonComments(raw)) as { $schema: string };
    assert.equal(parsed.$schema, "https://opencode.ai/config.json");
  });

  it("merges OpenCode config without overwriting existing MCP servers", () => {
    const existing = JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      mcp: {
        "other-server": { type: "local", command: ["node", "other.js"] },
      },
    });
    const merged = JSON.parse(mergeMcpConfig(existing, "opencode", "@zohairhussain/local-demo-mcp@1.0.5")) as {
      mcp: Record<string, unknown>;
    };
    assert.ok(merged.mcp["other-server"]);
    assert.deepEqual(merged.mcp["local-demo-mcp"], {
      type: "local",
      command: ["npx", "--yes", "@zohairhussain/local-demo-mcp@1.0.5"],
      enabled: true,
      environment: { GITHUB_TOKEN: "{env:GITHUB_TOKEN}" },
    });
  });

  it("merges Cursor, Claude Desktop, and VS Code configs cleanly", () => {
    const cursor = JSON.parse(mergeMcpConfig(null, "cursor")) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    assert.equal(cursor.mcpServers["local-demo-mcp"]?.command, "npx");

    const vscode = JSON.parse(mergeMcpConfig(null, "vscode")) as {
      servers: Record<string, { type: string; command: string }>;
    };
    assert.equal(vscode.servers["local-demo-mcp"]?.type, "stdio");
  });

  it("resolves OS-specific Claude Desktop paths", () => {
    const winTargets = getClientTargets("E:\\proj", "win32", "C:\\Users\\z", "C:\\Users\\z\\AppData\\Roaming");
    assert.equal(
      winTargets.find((t) => t.id === "claude")?.configPath,
      path.join("C:\\Users\\z\\AppData\\Roaming", "Claude", "claude_desktop_config.json")
    );
  });
});
