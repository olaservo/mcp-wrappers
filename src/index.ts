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
export { connectClient } from "./connect.js";
export { NodeOAuthClientProvider } from "./oauth.js";
export {
  renderToolCatalog,
  renderSkillSeed,
  generateServerSkill,
  extractRequiredParams,
} from "./catalog.js";

export type { CreateTransportOptions } from "./transport.js";
export type { ConnectOptions } from "./connect.js";
export type { NodeOAuthOptions } from "./oauth.js";
export type {
  MCPServerConfig,
  MCPConfig,
  OAuthOptions,
  GenerationMetadata,
  GenerateWrappersOptions,
  GenerateServerResult,
  WrapperStatus,
  EnsureWrappersOptions,
  EnsureWrappersResult,
  RuntimeOptions,
} from "./types.js";
