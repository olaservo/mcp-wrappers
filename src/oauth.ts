// Node OAuth client provider for MCP servers protected by OAuth 2.1.
// Persists client registration + tokens to disk (so subsequent runs are
// non-interactive), opens the system browser for the authorization step, and
// captures the redirect via a short-lived localhost callback server.
import http from "http";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

type Logger = (msg: string) => void;

export interface NodeOAuthOptions {
  /** The MCP server URL (the protected resource). */
  serverUrl: string;
  /** Directory to persist client info + tokens. Default: ~/.mcp-wrappers/oauth. */
  storeDir?: string;
  /** Localhost port for the OAuth redirect URI. Default: 3334. */
  callbackPort?: number;
  /** client_name sent during dynamic client registration. Default: mcp-wrappers. */
  clientName?: string;
  /** Open the system browser automatically. Default: true. */
  openBrowser?: boolean;
  log?: Logger;
}

interface StoredCreds {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  state?: string;
}

export class NodeOAuthClientProvider implements OAuthClientProvider {
  private readonly serverUrl: string;
  private readonly storeDir: string;
  private readonly port: number;
  private readonly clientName: string;
  private readonly openBrowser: boolean;
  private readonly log: Logger;
  private readonly storeFile: string;

  private cache: StoredCreds | null = null;
  private server?: http.Server;
  private codePromise?: Promise<string>;

  constructor(options: NodeOAuthOptions) {
    this.serverUrl = options.serverUrl;
    this.storeDir = options.storeDir ?? path.join(os.homedir(), ".mcp-wrappers", "oauth");
    this.port = options.callbackPort ?? 3334;
    this.clientName = options.clientName ?? "mcp-wrappers";
    this.openBrowser = options.openBrowser ?? true;
    this.log = options.log ?? (() => {});
    const host = (() => {
      try {
        return new URL(this.serverUrl).host.replace(/[:.]/g, "_");
      } catch {
        return "server";
      }
    })();
    this.storeFile = path.join(this.storeDir, `${host}.json`);
  }

  get redirectUrl(): string {
    return `http://localhost:${this.port}/callback`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.clientName,
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  private async load(): Promise<StoredCreds> {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(await fs.readFile(this.storeFile, "utf-8")) as StoredCreds;
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  private async persist(): Promise<void> {
    await fs.mkdir(this.storeDir, { recursive: true });
    await fs.writeFile(this.storeFile, JSON.stringify(this.cache ?? {}, null, 2));
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return (await this.load()).clientInformation;
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    (await this.load()).clientInformation = info;
    await this.persist();
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.load()).tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    (await this.load()).tokens = tokens;
    await this.persist();
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    (await this.load()).codeVerifier = codeVerifier;
    await this.persist();
  }

  async codeVerifier(): Promise<string> {
    const v = (await this.load()).codeVerifier;
    if (!v) throw new Error("No PKCE code verifier saved for this OAuth session");
    return v;
  }

  async state(): Promise<string> {
    const data = await this.load();
    if (!data.state) {
      data.state = randomUUID();
      await this.persist();
    }
    return data.state;
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    const data = await this.load();
    if (scope === "all" || scope === "client") delete data.clientInformation;
    if (scope === "all" || scope === "tokens") delete data.tokens;
    if (scope === "all" || scope === "verifier") delete data.codeVerifier;
    await this.persist();
  }

  /** Called by the SDK during connect when interactive authorization is required. */
  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    this.startCallbackServer();
    this.log(`[oauth] Authorize ${this.serverUrl} in your browser:`);
    this.log(`        ${authorizationUrl.toString()}`);
    if (this.openBrowser) this.tryOpenBrowser(authorizationUrl.toString());
  }

  /** Resolves with the authorization code captured by the callback server. */
  waitForAuthorizationCode(): Promise<string> {
    if (!this.codePromise) {
      throw new Error("redirectToAuthorization was not invoked; no pending OAuth code");
    }
    return this.codePromise;
  }

  close(): void {
    this.server?.close();
    this.server = undefined;
  }

  private startCallbackServer(): void {
    if (this.server) return;
    this.codePromise = new Promise<string>((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        if (!req.url) return;
        const url = new URL(req.url, this.redirectUrl);
        if (url.pathname !== "/callback") {
          res.writeHead(404).end();
          return;
        }
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        res.writeHead(200, { "Content-Type": "text/html" });
        if (error) {
          res.end(`<h3>Authorization failed: ${error}</h3>You can close this window.`);
          reject(new Error(`OAuth authorization error: ${error}`));
        } else if (code) {
          res.end("<h3>Authorization complete.</h3>You can close this window and return to the terminal.");
          resolve(code);
        } else {
          res.end("<h3>Missing authorization code.</h3>You can close this window.");
          reject(new Error("OAuth callback did not include an authorization code"));
        }
      });
      this.server.on("error", reject);
      this.server.listen(this.port);
    });
  }

  private tryOpenBrowser(url: string): void {
    try {
      const platform = process.platform;
      if (platform === "win32") {
        // Use rundll32 (ShellExecute) instead of `cmd /c start`, which treats
        // & and % as metacharacters even inside quotes and truncates OAuth URLs
        // (dropping every query param after the first &). rundll32 receives the
        // URL as a literal argv element, so no shell parsing occurs.
        spawn("rundll32", ["url.dll,FileProtocolHandler", url], {
          detached: true,
          stdio: "ignore",
        }).unref();
      } else if (platform === "darwin") {
        spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
      } else {
        spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
      }
    } catch {
      // Browser launch is best-effort; the URL is already logged for manual use.
    }
  }
}
