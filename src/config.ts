// Configuration loading for MCP servers, with ${VAR} environment substitution.
import * as fs from "fs/promises";
import type { MCPConfig } from "./types.js";

/**
 * Load MCP server configuration from a JSON file (no substitution).
 */
export async function loadMCPConfig(
  configPath: string = "./.mcp.json"
): Promise<MCPConfig> {
  const raw = await fs.readFile(configPath, "utf-8");
  return JSON.parse(raw) as MCPConfig;
}

/**
 * Substitute environment variables in MCP server configuration.
 * Replaces `${VAR_NAME}` patterns (in any string value) with values from
 * `process.env`, falling back to an empty string when undefined.
 */
export function substituteMCPEnvVariables(config: MCPConfig): MCPConfig {
  function substituteInValue(value: unknown): unknown {
    if (typeof value === "string") {
      return value.replace(/\$\{([^}]+)\}/g, (_, varName) => process.env[varName] || "");
    }
    if (Array.isArray(value)) {
      return value.map(substituteInValue);
    }
    if (value && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(value)) {
        result[key] = substituteInValue(v);
      }
      return result;
    }
    return value;
  }

  // Deep clone via the substitution walk (strings are replaced, everything else copied).
  return substituteInValue(config) as MCPConfig;
}

/**
 * Load MCP configuration and substitute environment variables in one step.
 */
export async function loadMCPConfigWithEnvSubstitution(
  configPath: string = "./.mcp.json"
): Promise<MCPConfig> {
  const config = await loadMCPConfig(configPath);
  return substituteMCPEnvVariables(config);
}
