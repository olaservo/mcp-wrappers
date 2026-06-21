# @olaservo/mcp-wrappers

Generate typed TypeScript wrappers for MCP tools so an agent can call them as
**code** instead of over the protocol — the "MCP as code" / code-execution pattern.
Ships the generator, the runtime bridge generated code calls, and a staleness-aware
lifecycle helper.

## What it does

Given an `.mcp.json` listing one or more MCP servers, the generator:

1. connects to each server and lists its tools,
2. compiles every tool's input/output JSON Schema into TypeScript interfaces,
3. emits one wrapper function per tool under `./servers/<server>/`, plus an
   `index.ts`, a pointer `README.md`, and a `.metadata.json`, and
4. emits a per-server **skill** under `./.claude/skills/<server>-server/` — a
   `SKILL.md` seed (curated by hand thereafter) and an always-regenerated
   `references/tools.md` catalog with descriptions and behavior hints.

Each generated wrapper imports `callMCPTool` from this package's `/runtime`
export, which maintains a per-server client connection pool and unwraps results
(`structuredContent` preferred, text/JSON fallback, `isError` → thrown `Error`).

Both the generator and the runtime support **stdio**, **static-credential HTTP**
(headers in config), and **OAuth 2.1 HTTP** servers (see below).

## Install

```bash
npm install @olaservo/mcp-wrappers @modelcontextprotocol/sdk
```

`@modelcontextprotocol/sdk` is a peer dependency.

## CLI

```bash
# generate wrappers + skills for every server in ./.mcp.json
npx mcp-wrappers generate

# check freshness and regenerate missing/stale wrappers (in-process)
npx mcp-wrappers ensure
```

Common options: `--config=<path>`, `--output=<dir>`, `--skills=<dir>`,
`--timeout=<ms>`, `--runtime-import=<id>`, `--no-skill`, `--no-regenerate`,
`--quiet`. OAuth options: `--no-interactive`, `--callback-port=<n>`,
`--oauth-store=<dir>`. The CLI loads `.env` from the working directory so `${VAR}`
substitution in `.mcp.json` (e.g. `Authorization: Bearer ${GITHUB_PAT}`) works.

## Server configuration

Each entry under `mcpServers` in `.mcp.json` is one of three shapes:

```jsonc
{
  "mcpServers": {
    // stdio — local subprocess
    "local": { "type": "stdio", "command": "my-server", "args": ["--flag"] },

    // HTTP with a static credential (PAT/API key)
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": { "Authorization": "Bearer ${GITHUB_PAT}" }
    },

    // HTTP behind OAuth 2.1
    "guildbridge": {
      "type": "http",
      "url": "https://guildbridge.modelcontextprotocol.io/mcp",
      "auth": "oauth"
    }
  }
}
```

## OAuth 2.1 servers

Set `"auth": "oauth"` on an HTTP server and the library runs the full
authorization-code + PKCE flow, with **dynamic client registration** — no
client ID/secret to configure. On first use it:

1. registers a client and starts a localhost callback server,
2. opens your browser to the authorization page (the URL is also printed, in
   case the browser doesn't open),
3. exchanges the returned code for tokens, and
4. **caches** the client registration + tokens under
   `~/.mcp-wrappers/oauth/<host>.json`.

Subsequent runs are non-interactive — cached tokens are reused and refreshed
automatically via the refresh token, so no browser is needed. This applies to
both `generate`/`ensure` (at generation time) and the runtime bridge (at call
time).

For headless environments, pass `--no-interactive` (CLI) or `interactive: false`
(API) to fail fast instead of attempting a browser flow. Tune the flow with
`--callback-port` / `--oauth-store` (CLI) or the `oauth` option (API).

> **Security note:** OAuth tokens are cached **unencrypted** on disk under
> `~/.mcp-wrappers/oauth/`. Treat that directory like any other credential
> store. Delete a server's file there to force re-authorization.

## Programmatic API

```ts
import { generateWrappers, ensureWrappers } from "@olaservo/mcp-wrappers";

await generateWrappers({ configPath: "./.mcp.json", outputDir: "./servers" });

const status = await ensureWrappers({ regenerate: true, timeoutMs: 10000 });
if (!status.success) throw new Error(status.errors.join("; "));
```

Generated wrappers import the runtime by a stable specifier:

```ts
import { callMCPTool } from "@olaservo/mcp-wrappers/runtime";
```

Override it with `runtimeImport` (e.g. `"../client.js"`) if you vendor a client.
If your config lives somewhere other than `./.mcp.json`, call
`configureRuntime({ configPath })` once at startup.

## License

Apache-2.0
