// Shared types for the MCP wrapper generator, runtime, and lifecycle.

/**
 * Configuration for a single MCP server. Mirrors an entry under `mcpServers`
 * in an `.mcp.json` file. Extra keys are tolerated (e.g. transport-specific options).
 */
export interface MCPServerConfig {
  /** Transport: "stdio" (local subprocess) or "http" (remote StreamableHTTP). */
  type?: "stdio" | "http";
  /** stdio: executable to spawn. */
  command?: string;
  /** stdio: arguments passed to the command. */
  args?: string[];
  /** stdio: environment for the subprocess. */
  env?: Record<string, string>;
  /** http: server URL. */
  url?: string;
  /** http: extra request headers (e.g. Authorization). */
  headers?: Record<string, string>;
  [key: string]: unknown;
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

/** Metadata written alongside generated wrappers, used for staleness detection. */
export interface GenerationMetadata {
  generatedAt: string;
  serverName: string;
  toolCount: number;
  generationDurationMs: number;
  hasInstructions: boolean;
}

export interface GenerateWrappersOptions {
  /** Path to the `.mcp.json` config. Default: `./.mcp.json`. */
  configPath?: string;
  /** Root directory wrapper folders are written under. Default: `./servers`. */
  outputDir?: string;
  /** Root directory server skills are written under. Default: `./.claude/skills`. */
  skillsDir?: string;
  /** Per-operation timeout in ms (connect, listTools). Default: 30000. */
  timeoutMs?: number;
  /** Emit the per-server skill (SKILL.md seed + references/tools.md). Default: true. */
  emitSkill?: boolean;
  /**
   * Module specifier the generated wrappers import `callMCPTool` from.
   * Default: `@olaservo/mcp-wrappers/runtime`. Use `../client.js` to target a
   * vendored client checked in alongside the wrappers.
   */
  runtimeImport?: string;
  /** Log progress to the console. Default: true. */
  verbose?: boolean;
}

/** Result of generating wrappers for a single server. */
export interface GenerateServerResult {
  serverName: string;
  metadata: GenerationMetadata;
}

export interface WrapperStatus {
  serverName: string;
  exists: boolean;
  metadata: GenerationMetadata | null;
  ageMs: number | null;
  toolCount: number;
}

export interface EnsureWrappersOptions {
  /** Path to the `.mcp.json` config. Default: `./.mcp.json`. */
  configPath?: string;
  /** Root directory wrapper folders live under. Default: `./servers`. */
  outputDir?: string;
  /** Root directory server skills live under. Default: `./.claude/skills`. */
  skillsDir?: string;
  /** Regenerate when wrappers are missing or stale. Default: true. */
  regenerate?: boolean;
  /** Per-operation timeout in ms passed to the generator. Default: 10000. */
  timeoutMs?: number;
  /** Module specifier passed through to the generator. */
  runtimeImport?: string;
  /** Log progress to the console. Default: true. */
  verbose?: boolean;
}

export interface EnsureWrappersResult {
  success: boolean;
  servers: WrapperStatus[];
  regenerated: boolean;
  warnings: string[];
  errors: string[];
}

export interface RuntimeOptions {
  /** Path to the `.mcp.json` config used to resolve servers. Default: `./.mcp.json`. */
  configPath?: string;
  /** Pre-resolved config (already env-substituted). Overrides `configPath` when set. */
  config?: MCPConfig;
}
