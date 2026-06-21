// Lifecycle: ensure wrappers exist and are fresh, regenerating in-process when
// missing or stale, and falling back to cached wrappers when regeneration fails.
import fs from "fs/promises";
import path from "path";
import { loadMCPConfig } from "./config.js";
import { generateWrappers } from "./generate.js";
import type {
  EnsureWrappersOptions,
  EnsureWrappersResult,
  GenerationMetadata,
  WrapperStatus,
} from "./types.js";

const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function checkWrapperStatus(
  serverName: string,
  outputDir: string
): Promise<WrapperStatus> {
  const serverDir = path.join(outputDir, serverName);

  try {
    const files = await fs.readdir(serverDir);
    const hasIndex = files.includes("index.ts");
    const wrapperFiles = files.filter((f) => f.endsWith(".ts") && f !== "index.ts");

    if (!hasIndex || wrapperFiles.length === 0) {
      return { serverName, exists: false, metadata: null, ageMs: null, toolCount: 0 };
    }

    let metadata: GenerationMetadata | null = null;
    let ageMs: number | null = null;
    try {
      const data = await fs.readFile(path.join(serverDir, ".metadata.json"), "utf-8");
      metadata = JSON.parse(data);
      if (metadata) ageMs = Date.now() - new Date(metadata.generatedAt).getTime();
    } catch {
      // No metadata file — that's okay.
    }

    return { serverName, exists: true, metadata, ageMs, toolCount: wrapperFiles.length };
  } catch {
    return { serverName, exists: false, metadata: null, ageMs: null, toolCount: 0 };
  }
}

/**
 * Ensure wrappers are available for every server in the config, regenerating
 * in-process when missing or stale and falling back to cached wrappers on failure.
 */
export async function ensureWrappers(
  options: EnsureWrappersOptions = {}
): Promise<EnsureWrappersResult> {
  const {
    configPath = "./.mcp.json",
    outputDir = "./servers",
    skillsDir = "./.claude/skills",
    regenerate = true,
    timeoutMs = 10000,
    runtimeImport,
    verbose = true,
  } = options;

  const log = verbose ? (msg: string) => console.log(msg) : () => {};

  const result: EnsureWrappersResult = {
    success: true,
    servers: [],
    regenerated: false,
    warnings: [],
    errors: [],
  };

  log("[Wrappers] Checking MCP wrapper status...");

  let serverNames: string[] = [];
  try {
    const config = await loadMCPConfig(configPath);
    serverNames = Object.keys(config.mcpServers || {});
  } catch {
    result.errors.push(`Failed to read MCP configuration at ${configPath}`);
    result.success = false;
    return result;
  }

  for (const serverName of serverNames) {
    result.servers.push(await checkWrapperStatus(serverName, outputDir));
  }

  const missingServers = result.servers.filter((s) => !s.exists);
  const staleServers = result.servers.filter(
    (s) => s.exists && s.ageMs !== null && s.ageMs > STALE_THRESHOLD_MS
  );

  if (missingServers.length > 0) {
    log(`[Wrappers] Missing wrappers for: ${missingServers.map((s) => s.serverName).join(", ")}`);
  }
  for (const server of staleServers) {
    const days = Math.floor((server.ageMs || 0) / (24 * 60 * 60 * 1000));
    result.warnings.push(`Wrappers for ${server.serverName} are ${days} days old`);
    log(`[Wrappers] Warning: ${server.serverName} wrappers are ${days} days old`);
  }

  if (regenerate) {
    log(`[Wrappers] Regenerating wrappers (timeout: ${timeoutMs}ms)...`);
    result.regenerated = true;

    const { errors } = await generateWrappers({
      configPath,
      outputDir,
      skillsDir,
      timeoutMs,
      runtimeImport,
      verbose,
    });

    // Re-check status after the attempt.
    result.servers = [];
    for (const serverName of serverNames) {
      result.servers.push(await checkWrapperStatus(serverName, outputDir));
    }

    if (errors.length === 0) {
      log("[Wrappers] Regeneration successful");
    } else {
      log("[Wrappers] Regeneration had failures, checking for fallback...");
      const stillMissing = result.servers.filter((s) => !s.exists);
      if (stillMissing.length > 0) {
        result.errors.push(
          `Failed to regenerate wrappers and no fallback available for: ${stillMissing
            .map((s) => s.serverName)
            .join(", ")}`
        );
        result.success = false;
      } else {
        result.warnings.push("Regeneration failed but using cached wrappers");
        log("[Wrappers] Using cached wrappers as fallback");
      }
    }
  } else if (missingServers.length > 0) {
    result.errors.push(`Missing wrappers for: ${missingServers.map((s) => s.serverName).join(", ")}`);
    result.success = false;
  }

  log("[Wrappers] Status:");
  for (const server of result.servers) {
    if (server.exists) {
      const age = server.ageMs
        ? `${Math.floor(server.ageMs / (60 * 60 * 1000))}h old`
        : "unknown age";
      log(`  ${server.serverName}: ${server.toolCount} tools (${age})`);
    } else {
      log(`  ${server.serverName}: MISSING`);
    }
  }

  return result;
}
