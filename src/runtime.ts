// MCP runtime bridge — connects generated wrapper functions to live MCP servers.
// This is the module generated wrappers import `callMCPTool` from.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createTransport } from "./transport.js";
import { loadMCPConfigWithEnvSubstitution } from "./config.js";
import type { MCPConfig, RuntimeOptions } from "./types.js";

const mcpClients = new Map<string, Client>();

let runtimeConfigPath = "./.mcp.json";
let runtimeConfig: MCPConfig | undefined;

/**
 * Configure how the runtime resolves server connection details. Call once at
 * startup if your `.mcp.json` is not at `./.mcp.json`, or to inject a
 * pre-resolved (already env-substituted) config.
 */
export function configureRuntime(options: RuntimeOptions): void {
  if (options.configPath) runtimeConfigPath = options.configPath;
  if (options.config) runtimeConfig = options.config;
}

/**
 * Calls an MCP tool by server name and tool name.
 * Works with both stdio and HTTP transports.
 */
export async function callMCPTool<T = any>(
  serverName: string,
  toolName: string,
  input: any
): Promise<T> {
  let client = mcpClients.get(serverName);
  if (!client) {
    client = await connectToMCPServer(serverName);
    mcpClients.set(serverName, client);
  }

  const result = await client.callTool({ name: toolName, arguments: input });

  // Tool signalled failure — throw so generated code can use try/catch.
  if (result.isError) {
    const msg = Array.isArray(result.content)
      ? result.content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n")
      : "";
    throw new Error(`${serverName}.${toolName} failed: ${msg || "tool call failed"}`);
  }

  // Per MCP spec: a tool that declares outputSchema MUST return structuredContent.
  // Prefer it over re-parsing the back-compat TextContent mirror.
  if (result.structuredContent !== undefined) {
    return result.structuredContent as T;
  }

  // Fallback: parse the content blocks. Join all text chunks (not just [0]),
  // then JSON.parse if the joined text parses cleanly.
  if (Array.isArray(result.content) && result.content.length > 0) {
    const allText = result.content.every((c: any) => c.type === "text");
    if (allText) {
      const text = result.content.map((c: any) => ("text" in c ? c.text : "")).join("\n");
      try {
        return JSON.parse(text);
      } catch {
        return text as T;
      }
    }
    // Mixed content (text + image/audio/resource) — hand back the array,
    // since binary blocks have no clean plain-value representation.
    return result.content as T;
  }

  return result as T;
}

/**
 * Get or create an MCP client for a server (for debugging/inspection).
 */
export async function getMCPClient(serverName: string): Promise<Client> {
  let client = mcpClients.get(serverName);
  if (!client) {
    client = await connectToMCPServer(serverName);
    mcpClients.set(serverName, client);
  }
  return client;
}

async function connectToMCPServer(serverName: string): Promise<Client> {
  const config = runtimeConfig ?? (await loadMCPConfigWithEnvSubstitution(runtimeConfigPath));
  const serverConfig = config.mcpServers?.[serverName];
  if (!serverConfig) {
    throw new Error(`MCP server '${serverName}' not found in config`);
  }

  const transport = createTransport(serverConfig);
  const client = new Client({ name: "agent-mcp-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  console.log(`[MCP Client] Connected to ${serverName} server`);
  return client;
}
