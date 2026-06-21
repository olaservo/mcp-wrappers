// Connects an MCP Client to a server, transparently handling OAuth 2.1 servers.
// For static-credential servers (headers in config) this is a plain connect.
// For `auth: "oauth"` servers it drives the interactive authorization flow:
// connect → UnauthorizedError → browser consent → finishAuth → reconnect.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createTransport } from "./transport.js";
import { NodeOAuthClientProvider } from "./oauth.js";
import type { MCPServerConfig, OAuthOptions } from "./types.js";

type Logger = (msg: string) => void;

export interface ConnectOptions {
  serverName: string;
  serverConfig: MCPServerConfig;
  clientInfo: { name: string; version: string };
  timeoutMs?: number;
  /** Permit the interactive browser OAuth flow. Default: true. */
  interactive?: boolean;
  oauth?: OAuthOptions;
  log?: Logger;
}

function withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Operation '${operation}' timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/**
 * Connect a fresh MCP Client to the given server and return it (connected).
 * Throws on failure; the caller owns closing the client.
 */
export async function connectClient(opts: ConnectOptions): Promise<Client> {
  const {
    serverName,
    serverConfig,
    clientInfo,
    timeoutMs = 30000,
    interactive = true,
    log = () => {},
  } = opts;

  const useOAuth = serverConfig.auth === "oauth";
  let provider: NodeOAuthClientProvider | undefined;
  if (useOAuth) {
    if (serverConfig.type !== "http" || !serverConfig.url) {
      throw new Error(`OAuth requires an http server with a 'url' (server '${serverName}')`);
    }
    provider = new NodeOAuthClientProvider({
      serverUrl: serverConfig.url,
      storeDir: opts.oauth?.storeDir,
      callbackPort: opts.oauth?.callbackPort,
      clientName: opts.oauth?.clientName,
      log,
    });
  }

  const connectFresh = async (): Promise<Client> => {
    const client = new Client(clientInfo, { capabilities: {} });
    await client.connect(createTransport(serverConfig, { authProvider: provider }));
    return client;
  };

  // First attempt — succeeds outright for static-credential servers and for
  // OAuth servers that already have cached (or refreshable) tokens.
  try {
    return await withTimeout(connectFresh(), timeoutMs, `connecting to ${serverName}`);
  } catch (err) {
    if (!provider || !(err instanceof UnauthorizedError)) throw err;
    if (!interactive) {
      throw new Error(
        `${serverName} requires OAuth authorization. Re-run interactively (without --no-interactive) to authorize.`
      );
    }
  }

  // The failed connect already invoked provider.redirectToAuthorization (browser
  // opened). Wait for the user, exchange the code for tokens, then reconnect.
  try {
    const code = await provider.waitForAuthorizationCode();
    const authTransport = createTransport(serverConfig, {
      authProvider: provider,
    }) as StreamableHTTPClientTransport;
    await authTransport.finishAuth(code);
    return await withTimeout(connectFresh(), timeoutMs, `reconnecting to ${serverName}`);
  } finally {
    provider.close();
  }
}
