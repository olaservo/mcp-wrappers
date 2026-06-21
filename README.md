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
`--quiet`. The CLI loads `.env` from the working directory so `${VAR}`
substitution in `.mcp.json` (e.g. `Authorization: Bearer ${GITHUB_PAT}`) works.

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
