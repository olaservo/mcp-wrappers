// Public API barrel for @olaservo/mcp-wrappers.

export { generateWrappers, generateServer, generateToolWrapper, buildJsDoc } from "./generate.js";
export { ensureWrappers } from "./ensure.js";
export {
  callMCPTool,
  getMCPClient,
  configureRuntime,
} from "./runtime.js";
export {
  loadMCPConfig,
  substituteMCPEnvVariables,
  loadMCPConfigWithEnvSubstitution,
} from "./config.js";
export { createTransport } from "./transport.js";
export {
  renderToolCatalog,
  renderSkillSeed,
  generateServerSkill,
  extractRequiredParams,
} from "./catalog.js";

export type {
  MCPServerConfig,
  MCPConfig,
  GenerationMetadata,
  GenerateWrappersOptions,
  GenerateServerResult,
  WrapperStatus,
  EnsureWrappersOptions,
  EnsureWrappersResult,
  RuntimeOptions,
} from "./types.js";
