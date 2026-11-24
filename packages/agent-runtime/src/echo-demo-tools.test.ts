import { describe, expect, it } from "vitest";
import { EchoProviderAdapter, ProviderRegistry, type LLMProviderAdapter, type ProviderCallRequest } from "@ai-orchestrator/provider-sdk";
import type { ToolCall } from "@ai-orchestrator/shared";
import { DefaultAgentRuntime } from "./default-agent-runtime";

/** Stands in for the Echo provider id and asks for whatever calls it is scripted with, every turn. */
class ScriptedEcho implements LLMProviderAdapter {
  readonly definition = { id: "echo", label: "Scripted echo", supportsTools: true, configSchema: {} };
  readonly requests: ProviderCallRequest[] = [];
  constructor(private readonly calls: ToolCall[]) {}
  async generate(request: ProviderCallRequest) {
    this.requests.push(request);
    const done = request.messages.some((message) => message.role === "tool");
    return done ? { content: "done", toolCalls: [] } : { content: "calling", toolCalls: this.calls };
  }
}

const TOOLS = [
  { serverId: "crm", name: "find_contact", description: "Find a contact", inputSchema: { type: "object" } },
  { serverId: "crm", name: "delete_contact", description: "Delete a contact", inputSchema: { type: "object" } }
];

async function run(provider: LLMProviderAdapter, readOnlyToolNames?: string[]) {
  const registry = new ProviderRegistry();
  registry.register(provider);
  const invoked: string[] = [];
  const state = await new DefaultAgentRuntime().run(
    { provider: { providerId: "echo", model: "demo" }, systemPrompt: "", userPrompt: "find Ada", tools: TOOLS, maxIterations: 4, toolCallingEnabled: true, bypassToolFiltering: true },
    {
      tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      invokeTool: async (name) => {
        invoked.push(name);
        return { ok: true };
      },
      ...(readOnlyToolNames ? { readOnlyToolNames } : {})
    },
    { providerRegistry: registry, resolveSecret: async () => undefined }
  );
  return { state, invoked };
}

describe("agent loop: the Echo test model's demo tool call", () => {
  it("passes Echo the read-only tools, and the real Echo calls one of them once", async () => {
    const { state, invoked } = await run(new EchoProviderAdapter(), ["find_contact"]);
    expect(invoked).toEqual(["find_contact"]);
    expect(state.finalAnswer).toContain("Echo is a test model");
  });

  it("drops an Echo call to a tool that is not read-only", async () => {
    const provider = new ScriptedEcho([{ id: "c1", name: "delete_contact", arguments: {} }]);
    const { invoked } = await run(provider, ["find_contact"]);
    expect(invoked).toEqual([]);
    expect(provider.requests[0]?.options?.demoReadOnlyTools).toEqual(["find_contact"]);
  });

  it("keeps at most one Echo call per run", async () => {
    const provider = new ScriptedEcho([
      { id: "c1", name: "find_contact", arguments: {} },
      { id: "c2", name: "find_contact", arguments: {} }
    ]);
    const { invoked } = await run(provider, ["find_contact"]);
    expect(invoked).toEqual(["find_contact"]);
  });

  it("lets Echo call nothing when the caller names no read-only tools", async () => {
    const provider = new ScriptedEcho([{ id: "c1", name: "find_contact", arguments: {} }]);
    const { invoked } = await run(provider);
    expect(invoked).toEqual([]);
  });

  it("does not send the demo option to other providers", async () => {
    class Other extends ScriptedEcho {
      override readonly definition = { id: "other", label: "Other", supportsTools: true, configSchema: {} };
    }
    const provider = new Other([]);
    const registry = new ProviderRegistry();
    registry.register(provider);
    await new DefaultAgentRuntime().run(
      { provider: { providerId: "other", model: "m" }, systemPrompt: "", userPrompt: "hi", tools: TOOLS, maxIterations: 1, toolCallingEnabled: true },
      { tools: [], invokeTool: async () => ({}), readOnlyToolNames: ["find_contact"] },
      { providerRegistry: registry, resolveSecret: async () => undefined }
    );
    expect(provider.requests[0]?.options).toBeUndefined();
  });
});
