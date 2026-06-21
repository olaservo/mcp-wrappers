// Core generator: connect to an MCP server, list its tools, and emit typed
// TypeScript wrapper files plus a server skill catalog.
import { compile } from "json-schema-to-typescript";
import fs from "fs/promises";
import path from "path";
import { connectClient } from "./connect.js";
import { loadMCPConfigWithEnvSubstitution } from "./config.js";
import { generateServerSkill } from "./catalog.js";
import type {
  GenerateWrappersOptions,
  GenerateServerResult,
  GenerationMetadata,
  MCPServerConfig,
  OAuthOptions,
} from "./types.js";

const DEFAULT_RUNTIME_IMPORT = "@olaservo/mcp-wrappers/runtime";

type Logger = (msg: string) => void;

interface ResolvedOptions {
  configPath: string;
  outputDir: string;
  skillsDir: string;
  timeoutMs: number;
  emitSkill: boolean;
  runtimeImport: string;
  interactive: boolean;
  oauth?: OAuthOptions;
  log: Logger;
}

function resolveOptions(options: GenerateWrappersOptions = {}): ResolvedOptions {
  const verbose = options.verbose ?? true;
  return {
    configPath: options.configPath ?? "./.mcp.json",
    outputDir: options.outputDir ?? "./servers",
    skillsDir: options.skillsDir ?? "./.claude/skills",
    timeoutMs: options.timeoutMs ?? 30000,
    emitSkill: options.emitSkill ?? true,
    runtimeImport: options.runtimeImport ?? DEFAULT_RUNTIME_IMPORT,
    interactive: options.interactive ?? true,
    oauth: options.oauth,
    log: verbose ? (msg: string) => console.log(msg) : () => {},
  };
}

// Timeout wrapper for async operations.
function withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Operation '${operation}' timed out after ${ms}ms`)), ms);
    promise.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// Convert snake_case to PascalCase.
function toPascalCase(str: string): string {
  return str
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/**
 * Generate wrappers for every server in the config file.
 * Individual server failures are collected (not thrown) so a caller can decide
 * whether to fall back to cached wrappers.
 */
export async function generateWrappers(
  options: GenerateWrappersOptions = {}
): Promise<{ results: GenerateServerResult[]; errors: { serverName: string; error: Error }[] }> {
  const opts = resolveOptions(options);
  const config = await loadMCPConfigWithEnvSubstitution(opts.configPath);
  const servers = config.mcpServers ?? {};

  const results: GenerateServerResult[] = [];
  const errors: { serverName: string; error: Error }[] = [];

  for (const [name, serverConfig] of Object.entries(servers)) {
    try {
      const result = await generateServer(name, serverConfig, options);
      results.push(result);
    } catch (err) {
      errors.push({ serverName: name, error: err instanceof Error ? err : new Error(String(err)) });
      opts.log(
        `Error generating wrappers for ${name}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return { results, errors };
}

/**
 * Generate wrappers for a single MCP server. Throws on connection/listing failure.
 */
export async function generateServer(
  serverName: string,
  serverConfig: MCPServerConfig,
  options: GenerateWrappersOptions = {}
): Promise<GenerateServerResult> {
  const opts = resolveOptions(options);
  const startTime = Date.now();
  opts.log(`\nGenerating wrappers for server: ${serverName}`);

  const client = await connectClient({
    serverName,
    serverConfig,
    clientInfo: { name: "wrapper-generator", version: "1.0.0" },
    timeoutMs: opts.timeoutMs,
    interactive: opts.interactive,
    oauth: opts.oauth,
    log: opts.log,
  });
  opts.log(`Connected to ${serverName} MCP server`);

  try {
    const { tools } = await withTimeout(
      client.listTools(),
      opts.timeoutMs,
      `listing tools from ${serverName}`
    );
    opts.log(`Found ${tools.length} tools`);

    const serverDir = path.join(opts.outputDir, serverName);
    await fs.mkdir(serverDir, { recursive: true });

    // The SDK stores instructions in _instructions (private; from InitializeResult).
    const instructions = (client as any)._instructions as string | undefined;

    // Pointer README routing browsers of ./servers/<server>/ to the server skill.
    await fs.writeFile(path.join(serverDir, "README.md"), renderServerReadme(serverName));
    opts.log(`  Generated: README.md (pointer to server skill)`);

    for (const tool of tools) {
      const fileName = `${tool.name.replace(/^.*__/, "")}.ts`;
      const wrapper = await generateToolWrapper(serverName, tool, opts.runtimeImport);
      await fs.writeFile(path.join(serverDir, fileName), wrapper);
      opts.log(`  Generated: ${fileName}`);
    }

    // index.ts re-exports every wrapper.
    const indexContent = tools
      .map((t) => `export * from './${t.name.replace(/^.*__/, "")}.js';`)
      .join("\n");
    await fs.writeFile(path.join(serverDir, "index.ts"), indexContent);
    opts.log(`  Generated: index.ts`);

    const metadata: GenerationMetadata = {
      generatedAt: new Date().toISOString(),
      serverName,
      toolCount: tools.length,
      generationDurationMs: Date.now() - startTime,
      hasInstructions: !!instructions,
    };
    await fs.writeFile(
      path.join(serverDir, ".metadata.json"),
      JSON.stringify(metadata, null, 2)
    );
    opts.log(`  Saved metadata to .metadata.json`);

    if (opts.emitSkill) {
      await generateServerSkill(serverName, tools, instructions, opts.skillsDir, opts.log);
    }

    opts.log(`Completed wrappers for ${serverName} in ${metadata.generationDurationMs}ms`);
    return { serverName, metadata };
  } finally {
    await client.close();
  }
}

function renderServerReadme(serverName: string): string {
  return `# ${serverName} MCP server

Tool wrappers for the **${serverName}** MCP server.

For the curated tool index, server instructions, and known gotchas, see the server skill:

\`\`\`
.claude/skills/${serverName}-server/
\`\`\`

In particular:
- \`.claude/skills/${serverName}-server/SKILL.md\` — overview, workhorses, gotchas
- \`.claude/skills/${serverName}-server/references/tools.md\` — full alphabetical catalog with descriptions, behavior hints, and required-parameter summaries (regenerated on every \`mcp-wrappers generate\` run)

The \`.ts\` files in this directory are auto-generated wrappers; their JSDoc carries each tool's full input/output types.
`;
}

// Build a JSDoc block from tool.description + tool.annotations.
// Annotation defaults follow the MCP spec (readOnlyHint=false, destructiveHint=true,
// idempotentHint=false, openWorldHint=true) so the agent always sees effective values
// even when the server omits them.
export function buildJsDoc(tool: any): string {
  const ann = tool.annotations ?? {};
  const lines: string[] = [];

  if (ann.title) {
    lines.push(String(ann.title));
    if (tool.description) {
      lines.push("");
      lines.push(...String(tool.description).split("\n"));
    }
  } else {
    lines.push(...String(tool.description || "No description provided").split("\n"));
  }

  const readOnly = ann.readOnlyHint ?? false;
  const destructive = ann.destructiveHint ?? true;
  const idempotent = ann.idempotentHint ?? false;
  const openWorld = ann.openWorldHint ?? true;

  const note = (key: string) => (key in ann ? "" : " [default]");

  lines.push("");
  lines.push("Behavior hints:");
  lines.push(
    `- Read-only: ${readOnly}${note("readOnlyHint")} (${readOnly ? "does not modify state" : "may modify state"})`
  );
  if (!readOnly) {
    lines.push(
      `- Destructive: ${destructive}${note("destructiveHint")} (${destructive ? "may perform non-additive updates" : "additive only"})`
    );
    lines.push(
      `- Idempotent: ${idempotent}${note("idempotentHint")} (${idempotent ? "safe to retry" : "repeated calls may have additional effects"})`
    );
  }
  lines.push(
    `- Open-world: ${openWorld}${note("openWorldHint")} (${openWorld ? "interacts with external entities" : "closed domain"})`
  );

  return lines.map((l) => (l ? ` * ${l.replace(/\*\//g, "* /")}` : " *")).join("\n");
}

/**
 * Render the TypeScript source for a single tool wrapper.
 */
export async function generateToolWrapper(
  serverName: string,
  tool: any,
  runtimeImport: string = DEFAULT_RUNTIME_IMPORT
): Promise<string> {
  const toolName = tool.name.replace(/^.*__/, "");
  const pascalName = toPascalCase(toolName);

  let inputInterface = "";
  let inputTypeName = "any";
  if (tool.inputSchema) {
    const inputInterfaceName = `${pascalName}Input`;
    inputInterface = await compile(tool.inputSchema, inputInterfaceName, {
      bannerComment: "",
      additionalProperties: false,
    });
    inputTypeName = inputInterfaceName;
  }

  let outputInterface = "";
  let outputTypeName = "any";
  if (tool.outputSchema) {
    const outputInterfaceName = `${pascalName}Output`;
    outputInterface = await compile(tool.outputSchema, outputInterfaceName, {
      bannerComment: "",
      additionalProperties: false,
    });
    outputTypeName = outputInterfaceName;
  }

  const jsDoc = buildJsDoc(tool);

  return `// Auto-generated wrapper for ${tool.name}
import { callMCPTool } from "${runtimeImport}";

${inputInterface}
${outputInterface}
/**
${jsDoc}
 */
export async function ${toolName}(input: ${inputTypeName}): Promise<${outputTypeName}> {
  return callMCPTool('${serverName}', '${tool.name}', input);
}
`;
}
