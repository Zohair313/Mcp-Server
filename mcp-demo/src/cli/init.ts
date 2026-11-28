import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";

export type ClientTargetId = "opencode" | "cursor" | "claude" | "vscode";

export interface ClientTarget {
  id: ClientTargetId;
  label: string;
  configPath: string;
}

export const DEFAULT_PACKAGE_SPEC = "@zohairhussain/local-demo-mcp@1.0.5";

/**
 * Resolves standard MCP configuration file paths for supported AI clients.
 */
export function getClientTargets(
  cwd = process.cwd(),
  platform: NodeJS.Platform = process.platform,
  homeDir = os.homedir(),
  appDataDir = process.env.APPDATA
): ClientTarget[] {
  let claudePath: string;
  if (platform === "win32") {
    const base = appDataDir || path.join(homeDir, "AppData", "Roaming");
    claudePath = path.join(base, "Claude", "claude_desktop_config.json");
  } else if (platform === "darwin") {
    claudePath = path.join(
      homeDir,
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json"
    );
  } else {
    claudePath = path.join(homeDir, ".config", "Claude", "claude_desktop_config.json");
  }

  return [
    {
      id: "opencode",
      label: "OpenCode (project opencode.jsonc)",
      configPath: path.join(cwd, "opencode.jsonc"),
    },
    {
      id: "cursor",
      label: "Cursor (global ~/.cursor/mcp.json)",
      configPath: path.join(homeDir, ".cursor", "mcp.json"),
    },
    {
      id: "claude",
      label: "Claude Desktop (global config)",
      configPath: claudePath,
    },
    {
      id: "vscode",
      label: "VS Code (workspace .vscode/mcp.json)",
      configPath: path.join(cwd, ".vscode", "mcp.json"),
    },
  ];
}

/**
 * Strips // and /* * / comments from JSONC text while preserving string literals.
 */
export function stripJsonComments(input: string): string {
  let out = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    const next = input[i + 1];

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }

    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    out += ch;
  }

  return out;
}

/**
 * Safely merges the local-demo-mcp server entry into an existing JSON/JSONC config string.
 */
export function mergeMcpConfig(
  existingRaw: string | null,
  targetId: ClientTargetId,
  packageSpec = DEFAULT_PACKAGE_SPEC
): string {
  let parsed: Record<string, unknown> = {};
  if (existingRaw && existingRaw.trim()) {
    const clean = stripJsonComments(existingRaw);
    const data = JSON.parse(clean) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Existing config root must be a JSON object.");
    }
    parsed = { ...(data as Record<string, unknown>) };
  }

  if (targetId === "opencode") {
    if (!parsed.$schema) {
      parsed.$schema = "https://opencode.ai/config.json";
    }
    const existingMcp =
      parsed.mcp && typeof parsed.mcp === "object" && !Array.isArray(parsed.mcp)
        ? { ...(parsed.mcp as Record<string, unknown>) }
        : {};
    existingMcp["local-demo-mcp"] = {
      type: "local",
      command: ["npx", "--yes", packageSpec],
      enabled: true,
      environment: {
        GITHUB_TOKEN: "{env:GITHUB_TOKEN}",
      },
    };
    parsed.mcp = existingMcp;
  } else if (targetId === "vscode") {
    const existingServers =
      parsed.servers && typeof parsed.servers === "object" && !Array.isArray(parsed.servers)
        ? { ...(parsed.servers as Record<string, unknown>) }
        : {};
    existingServers["local-demo-mcp"] = {
      type: "stdio",
      command: "npx",
      args: ["--yes", packageSpec],
      env: {
        GITHUB_TOKEN: "${env:GITHUB_TOKEN}",
      },
    };
    parsed.servers = existingServers;
  } else {
    // Cursor and Claude Desktop share the mcpServers schema.
    const existingServers =
      parsed.mcpServers &&
      typeof parsed.mcpServers === "object" &&
      !Array.isArray(parsed.mcpServers)
        ? { ...(parsed.mcpServers as Record<string, unknown>) }
        : {};
    existingServers["local-demo-mcp"] = {
      command: "npx",
      args: ["--yes", packageSpec],
      env: {
        GITHUB_TOKEN: "${GITHUB_TOKEN}",
      },
    };
    parsed.mcpServers = existingServers;
  }

  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function printManualConfig(packageSpec: string): void {
  console.log("\n--- Manual Configuration Snippets ---\n");
  console.log("1) OpenCode (opencode.jsonc):");
  console.log(mergeMcpConfig(null, "opencode", packageSpec));
  console.log("2) Cursor (~/.cursor/mcp.json) / Claude Desktop:");
  console.log(mergeMcpConfig(null, "cursor", packageSpec));
  console.log("3) VS Code (.vscode/mcp.json):");
  console.log(mergeMcpConfig(null, "vscode", packageSpec));
}

/**
 * Runs an interactive terminal setup wizard when invoked by a human in a TTY.
 */
export async function runInteractiveSetup(
  packageSpec = DEFAULT_PACKAGE_SPEC
): Promise<"done" | "start_server"> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log(`\n@zohairhussain/local-demo-mcp — Interactive Setup`);
    console.log("Choose how you want to set up this MCP server:");
    console.log("  1) Auto-configure on my system (OpenCode / Cursor / Claude Desktop / VS Code)");
    console.log("  2) Manual setup (show JSON config to copy-paste)");
    console.log("  3) Start MCP stdio server directly");

    const mode = (await rl.question("\nEnter choice (1/2/3) [1]: ")).trim() || "1";

    if (mode === "3") {
      return "start_server";
    }

    if (mode === "2") {
      printManualConfig(packageSpec);
      return "done";
    }

    const targets = getClientTargets();
    console.log("\nSelect tools to configure (comma-separated numbers, or 'all'):");
    targets.forEach((target, idx) => {
      console.log(`  ${idx + 1}) ${target.label} -> ${target.configPath}`);
    });

    const selection = (await rl.question("\nYour selection [all]: ")).trim().toLowerCase() || "all";
    const chosen =
      selection === "all"
        ? targets
        : selection
            .split(",")
            .map((s) => targets[Number(s.trim()) - 1])
            .filter((t): t is ClientTarget => Boolean(t));

    if (chosen.length === 0) {
      console.log("No valid targets selected. Exiting without changes.");
      return "done";
    }

    for (const target of chosen) {
      let existing: string | null = null;
      try {
        existing = await readFile(target.configPath, "utf-8");
      } catch {
        existing = null;
      }

      const updated = mergeMcpConfig(existing, target.id, packageSpec);
      await mkdir(path.dirname(target.configPath), { recursive: true });
      await writeFile(target.configPath, updated, "utf-8");
      console.log(`Updated: ${target.configPath}`);
    }

    console.log("\nSetup complete! Restart your selected AI tool(s) to load local-demo-mcp.");
    console.log("Tip: Set GITHUB_TOKEN in your environment for private repos and higher rate limits.");
    return "done";
  } finally {
    rl.close();
  }
}
