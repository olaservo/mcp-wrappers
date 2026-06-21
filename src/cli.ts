#!/usr/bin/env node
// CLI entry for @olaservo/mcp-wrappers. Subcommands: `generate`, `ensure`.
import dotenv from "dotenv";
import { generateWrappers } from "./generate.js";
import { ensureWrappers } from "./ensure.js";

// Load a consumer's .env from CWD so ${VAR} substitution (e.g. GITHUB_PAT) works.
dotenv.config();

interface ParsedArgs {
  flags: Set<string>;
  values: Map<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq === -1) {
      flags.add(body);
    } else {
      values.set(body.slice(0, eq), body.slice(eq + 1));
    }
  }
  return { flags, values };
}

function usage(): void {
  console.log(`mcp-wrappers — generate typed wrappers for MCP tools

Usage:
  mcp-wrappers generate [options]
  mcp-wrappers ensure   [options]

Options:
  --config=<path>        Path to .mcp.json (default: ./.mcp.json)
  --output=<dir>         Wrapper output root (default: ./servers)
  --skills=<dir>         Server-skill output root (default: ./.claude/skills)
  --timeout=<ms>         Per-operation timeout (default: generate 30000, ensure 10000)
  --runtime-import=<id>  Module wrappers import callMCPTool from
                         (default: @olaservo/mcp-wrappers/runtime)
  --no-skill             generate: skip the per-server skill emission
  --no-regenerate        ensure: report status only, never regenerate
  --no-interactive       Do not open a browser for OAuth servers (fail instead)
  --callback-port=<n>    Localhost port for the OAuth redirect (default: 3334)
  --oauth-store=<dir>    Where to cache OAuth tokens (default: ~/.mcp-wrappers/oauth)
  --quiet                Suppress progress logging
  -h, --help             Show this help

For OAuth 2.1 servers, add "auth": "oauth" to the server's entry in .mcp.json.
`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { flags, values } = parseArgs(rest);

  if (!command || flags.has("help") || flags.has("h") || command === "help") {
    usage();
    process.exit(command ? 0 : 1);
  }

  const verbose = !flags.has("quiet");
  const oauth = values.has("callback-port") || values.has("oauth-store")
    ? {
        callbackPort: values.has("callback-port")
          ? parseInt(values.get("callback-port")!, 10)
          : undefined,
        storeDir: values.get("oauth-store"),
      }
    : undefined;
  const common = {
    configPath: values.get("config"),
    outputDir: values.get("output"),
    skillsDir: values.get("skills"),
    runtimeImport: values.get("runtime-import"),
    interactive: !flags.has("no-interactive"),
    oauth,
    verbose,
  };
  const timeout = values.has("timeout") ? parseInt(values.get("timeout")!, 10) : undefined;

  if (command === "generate") {
    const { results, errors } = await generateWrappers({
      ...common,
      timeoutMs: timeout,
      emitSkill: !flags.has("no-skill"),
    });
    if (errors.length > 0) {
      console.error(
        `\nWrapper generation failed for: ${errors.map((e) => e.serverName).join(", ")}`
      );
      for (const e of errors) console.error(`  ${e.serverName}: ${e.error.message}`);
      process.exit(1);
    }
    if (verbose) {
      console.log(
        `\nGenerated wrappers for ${results.length} server(s): ${results
          .map((r) => `${r.serverName} (${r.metadata.toolCount} tools)`)
          .join(", ")}`
      );
    }
    return;
  }

  if (command === "ensure") {
    const result = await ensureWrappers({
      ...common,
      timeoutMs: timeout,
      regenerate: !flags.has("no-regenerate"),
    });
    if (!result.success) {
      console.error("[Wrappers] Failed to ensure wrappers are available");
      for (const err of result.errors) console.error(`  ${err}`);
      process.exit(1);
    }
    if (verbose) console.log("[Wrappers] All wrappers available");
    return;
  }

  console.error(`Unknown command: ${command}`);
  usage();
  process.exit(1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
