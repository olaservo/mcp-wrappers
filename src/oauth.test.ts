import { describe, it, expect, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { NodeOAuthClientProvider } from "./oauth.js";

const tmpDirs: string[] = [];
const providers: NodeOAuthClientProvider[] = [];

async function freshStore(): Promise<string> {
  // Unique per call; no Date.now()/random needed for uniqueness — mkdtemp adds it.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mcpw-oauth-"));
  tmpDirs.push(dir);
  return dir;
}

function makeProvider(storeDir: string, port: number): NodeOAuthClientProvider {
  const p = new NodeOAuthClientProvider({
    serverUrl: "https://guildbridge.example.io/mcp",
    storeDir,
    callbackPort: port,
    openBrowser: false,
  });
  providers.push(p);
  return p;
}

afterEach(async () => {
  for (const p of providers.splice(0)) p.close();
  for (const dir of tmpDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("NodeOAuthClientProvider — metadata", () => {
  it("builds a public-client metadata document with the callback redirect", async () => {
    const p = makeProvider(await freshStore(), 33401);
    expect(p.redirectUrl).toBe("http://localhost:33401/callback");
    const meta = p.clientMetadata;
    expect(meta.redirect_uris).toEqual(["http://localhost:33401/callback"]);
    expect(meta.token_endpoint_auth_method).toBe("none");
    expect(meta.grant_types).toContain("authorization_code");
    expect(meta.grant_types).toContain("refresh_token");
    expect(meta.response_types).toContain("code");
  });
});

describe("NodeOAuthClientProvider — persistence", () => {
  it("round-trips client info, tokens, and the PKCE verifier across instances", async () => {
    const storeDir = await freshStore();
    const a = makeProvider(storeDir, 33402);

    await a.saveClientInformation({ client_id: "abc", client_secret: "shh" } as any);
    await a.saveTokens({ access_token: "tok", token_type: "Bearer" } as any);
    await a.saveCodeVerifier("verifier-123");

    // A brand-new instance on the same store dir must read the persisted values.
    const b = makeProvider(storeDir, 33402);
    expect((await b.clientInformation())?.client_id).toBe("abc");
    expect((await b.tokens())?.access_token).toBe("tok");
    expect(await b.codeVerifier()).toBe("verifier-123");
  });

  it("throws when no code verifier has been saved", async () => {
    const p = makeProvider(await freshStore(), 33403);
    await expect(p.codeVerifier()).rejects.toThrow(/code verifier/i);
  });

  it("returns a stable, persisted state value", async () => {
    const storeDir = await freshStore();
    const a = makeProvider(storeDir, 33404);
    const s1 = await a.state();
    expect(await a.state()).toBe(s1);
    const b = makeProvider(storeDir, 33404);
    expect(await b.state()).toBe(s1);
  });

  it("invalidateCredentials clears the requested scope", async () => {
    const storeDir = await freshStore();
    const p = makeProvider(storeDir, 33405);
    await p.saveTokens({ access_token: "tok", token_type: "Bearer" } as any);
    await p.saveClientInformation({ client_id: "abc" } as any);

    await p.invalidateCredentials("tokens");
    expect(await p.tokens()).toBeUndefined();
    expect((await p.clientInformation())?.client_id).toBe("abc");

    await p.invalidateCredentials("all");
    expect(await p.clientInformation()).toBeUndefined();
  });
});

describe("NodeOAuthClientProvider — callback server", () => {
  it("captures the authorization code from the redirect", async () => {
    const p = makeProvider(await freshStore(), 33406);
    await p.redirectToAuthorization(new URL("https://auth.example/authorize?x=1"));
    const codeP = p.waitForAuthorizationCode();
    const res = await fetch("http://localhost:33406/callback?code=the-code&state=s");
    expect(res.status).toBe(200);
    expect(await codeP).toBe("the-code");
  });

  it("rejects when the redirect carries an error", async () => {
    const p = makeProvider(await freshStore(), 33407);
    await p.redirectToAuthorization(new URL("https://auth.example/authorize"));
    // Attach the rejection matcher BEFORE triggering the callback, so the
    // rejection is never momentarily unhandled.
    const assertion = expect(p.waitForAuthorizationCode()).rejects.toThrow(/access_denied/);
    await fetch("http://localhost:33407/callback?error=access_denied");
    await assertion;
  });

  it("waitForAuthorizationCode throws if redirect was never initiated", async () => {
    const p = makeProvider(await freshStore(), 33408);
    expect(() => p.waitForAuthorizationCode()).toThrow(/no pending OAuth code/i);
  });
});
