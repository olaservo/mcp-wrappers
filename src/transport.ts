// Transport factory shared by the generator and the runtime bridge.
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { MCPServerConfig } from "./types.js";

/**
 * Create an MCP client transport from a (already env-substituted) server config.
 * Supports "http" (StreamableHTTP, the modern recommended remote transport) and
 * "stdio" (local subprocess). Defaults to stdio when `type` is omitted.
 */
export function createTransport(config: MCPServerConfig): Transport {
  if (config.type === "http") {
    if (!config.url) {
      throw new Error("HTTP transport requires a 'url'");
    }
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: config.headers ? { headers: config.headers } : undefined,
    });
  }

  // Local stdio server (default).
  if (!config.command) {
    throw new Error("stdio transport requires a 'command'");
  }
  return new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.env,
  });
}
