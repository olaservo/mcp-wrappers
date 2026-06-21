import { describe, it, expect } from "vitest";
import { generateToolWrapper, buildJsDoc } from "./generate.js";
import {
  renderToolCatalog,
  renderSkillSeed,
  extractRequiredParams,
} from "./catalog.js";
import { substituteMCPEnvVariables } from "./config.js";
import type { MCPConfig } from "./types.js";

const sampleTool = {
  name: "github__list_issues",
  description: "List issues in a repository",
  inputSchema: {
    type: "object",
    properties: {
      owner: { type: "string" },
      repo: { type: "string" },
      state: { type: "string", enum: ["OPEN", "CLOSED"] },
    },
    required: ["owner", "repo"],
  },
  annotations: { readOnlyHint: true },
};

describe("generateToolWrapper", () => {
  it("strips the server prefix from the tool name but calls with the full name", async () => {
    const src = await generateToolWrapper("github", sampleTool);
    expect(src).toContain("export async function list_issues(");
    expect(src).toContain("callMCPTool('github', 'github__list_issues', input)");
  });

  it("compiles the input schema into a typed interface", async () => {
    const src = await generateToolWrapper("github", sampleTool);
    expect(src).toContain("interface ListIssuesInput");
    expect(src).toContain("owner");
    expect(src).toContain("repo");
    expect(src).toMatch(/state\?:\s*"OPEN"\s*\|\s*"CLOSED"/);
  });

  it("uses the default runtime import specifier", async () => {
    const src = await generateToolWrapper("github", sampleTool);
    expect(src).toContain('from "@olaservo/mcp-wrappers/runtime"');
  });

  it("honors a custom runtimeImport (vendored client)", async () => {
    const src = await generateToolWrapper("github", sampleTool, "../client.js");
    expect(src).toContain('from "../client.js"');
  });

  it("falls back to `any` types when no schema is present", async () => {
    const src = await generateToolWrapper("svc", { name: "ping" });
    expect(src).toContain("export async function ping(input: any): Promise<any>");
  });
});

describe("buildJsDoc", () => {
  it("marks spec-default behavior hints with [default]", () => {
    const doc = buildJsDoc({ name: "x", description: "desc" });
    expect(doc).toContain("Read-only: false [default]");
    expect(doc).toContain("Open-world: true [default]");
  });

  it("omits the [default] note when the annotation is explicit", () => {
    const doc = buildJsDoc({ name: "x", description: "desc", annotations: { readOnlyHint: true } });
    expect(doc).toContain("Read-only: true (does not modify state)");
    expect(doc).not.toContain("Read-only: true [default]");
  });
});

describe("renderToolCatalog", () => {
  it("classifies tools and tags them by behavior", () => {
    const md = renderToolCatalog("github", [sampleTool], "Server says hi");
    expect(md).toContain("# github tool catalog");
    expect(md).toContain("## Server instructions");
    expect(md).toContain("Server says hi");
    expect(md).toContain("- Read-only: 1");
    expect(md).toContain("### `github__list_issues` _(read-only)_");
    expect(md).toContain("Required: `owner`, `repo`");
  });
});

describe("renderSkillSeed", () => {
  it("emits valid frontmatter with the server name and tool count", () => {
    const seed = renderSkillSeed("github", 44);
    expect(seed).toContain("name: github-server");
    expect(seed).toContain("Indexes the 44 available tools");
    expect(seed).toContain("## Workhorses");
  });
});

describe("extractRequiredParams", () => {
  it("returns required string params", () => {
    expect(extractRequiredParams(sampleTool.inputSchema)).toEqual(["owner", "repo"]);
  });
  it("returns [] for malformed schema", () => {
    expect(extractRequiredParams(undefined)).toEqual([]);
    expect(extractRequiredParams({ required: "nope" })).toEqual([]);
  });
});

describe("substituteMCPEnvVariables", () => {
  it("replaces ${VAR} in nested string values", () => {
    process.env.TEST_PAT = "secret-123";
    const config: MCPConfig = {
      mcpServers: {
        github: {
          type: "http",
          url: "https://api.example.com/mcp/",
          headers: { Authorization: "Bearer ${TEST_PAT}" },
        },
      },
    };
    const out = substituteMCPEnvVariables(config);
    expect(out.mcpServers.github.headers!.Authorization).toBe("Bearer secret-123");
    // original is not mutated
    expect(config.mcpServers.github.headers!.Authorization).toBe("Bearer ${TEST_PAT}");
  });

  it("substitutes undefined vars with empty string", () => {
    const config: MCPConfig = {
      mcpServers: { x: { type: "http", url: "${NOT_SET_VAR_XYZ}" } },
    };
    expect(substituteMCPEnvVariables(config).mcpServers.x.url).toBe("");
  });
});
