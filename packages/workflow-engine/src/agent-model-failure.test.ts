/**
 * An agent whose run ended on an error rather than an answer (its model call failed before anything was answered)
 * fails its node: the run is an error, not a success whose answer is the provider's error text.
 */
import { describe, expect, it } from "vitest";
import type { AgentRuntimeAdapter } from "@ai-orchestrator/agent-runtime";
import { createDefaultConnectorRegistry } from "@ai-orchestrator/connector-sdk";
import { createDefaultMCPRegistry } from "@ai-orchestrator/mcp-sdk";
import { ProviderRegistry } from "@ai-orchestrator/provider-sdk";
import type { AgentRunState, Workflow } from "@ai-orchestrator/shared";
import { executeWorkflow } from "./executor";

const PROVIDER_ERROR = 'Provider ollama request failed (404): {"error":{"message":"model \\"qwen2.5:7b\\" not found"}}';

class StubAgentRuntime implements AgentRuntimeAdapter {
  readonly id = "stub-agent";
  constructor(private readonly state: AgentRunState) {}
  async run(): Promise<AgentRunState> {
    return this.state;
  }
}

function agentWorkflow(): Workflow {
  return {
    id: "wf-agent-failure",
    name: "Agent model failure",
    schemaVersion: "1.0.0",
    workflowVersion: 1,
    nodes: [
      { id: "webhook", type: "webhook_input", name: "Webhook", position: { x: 0, y: 0 }, config: {} },
      {
        id: "agent",
        type: "agent_orchestrator",
        name: "Agent",
        position: { x: 220, y: 0 },
        config: { systemPromptTemplate: "{{system_prompt}}", userPromptTemplate: "{{user_prompt}}", maxIterations: 1 }
      },
      {
        id: "model",
        type: "llm_call",
        name: "Chat Model",
        position: { x: 220, y: 180 },
        config: { provider: { providerId: "ollama", baseUrl: "http://127.0.0.1:9/v1", model: "qwen2.5:7b" } }
      },
      { id: "output", type: "output", name: "Output", position: { x: 430, y: 0 }, config: { responseTemplate: "{{answer}}" } }
    ],
    edges: [
      { id: "e1", source: "webhook", target: "agent" },
      { id: "e2", source: "agent", target: "output" },
      { id: "e3", source: "agent", sourceHandle: "chat_model", target: "model" }
    ]
  };
}

function run(state: AgentRunState) {
  return executeWorkflow(
    { workflow: agentWorkflow(), webhookPayload: { user_prompt: "hi", system_prompt: "be brief" } },
    {
      providerRegistry: new ProviderRegistry(),
      connectorRegistry: createDefaultConnectorRegistry(),
      mcpRegistry: createDefaultMCPRegistry(),
      agentRuntime: new StubAgentRuntime(state),
      resolveSecret: async () => undefined
    }
  );
}

describe("agent model failure", () => {
  it("fails the agent's node and the run when the agent ended on an error", async () => {
    const result = await run({
      finalAnswer: PROVIDER_ERROR,
      stopReason: "error",
      failure: new Error(PROVIDER_ERROR),
      iterations: 0,
      messages: [],
      steps: []
    });

    expect(result.status).toBe("error");
    expect(result.error).toBe(PROVIDER_ERROR);
    expect(result.nodeResults.find((entry) => entry.nodeId === "agent")?.status).toBe("error");
    expect(result.nodeResults.find((entry) => entry.nodeId === "output")?.status).not.toBe("success");
    // The attached chat model still records the failed call.
    const model = result.nodeResults.find((entry) => entry.nodeId === "model");
    expect(JSON.stringify(model?.output)).toContain('"stopReason":"error"');
  });

  it("keeps an answer the agent gave before a later model call failed", async () => {
    const result = await run({
      finalAnswer: "Partial answer from the first iteration",
      stopReason: "error",
      iterations: 1,
      messages: [],
      steps: []
    });

    expect(result.status).toBe("success");
    expect(JSON.stringify(result.output)).toContain("Partial answer from the first iteration");
  });
});
