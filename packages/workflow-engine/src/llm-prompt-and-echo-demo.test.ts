/**
 * Launch fixes: an LLM node's prompt comes from what reached it (its own Prompt, the run's prompt, a message, or the
 * parent's content such as a webhook body) and is never sent empty; an agent on the built-in Echo test model makes one
 * demo tool call, only to a tool L2M classifies read-only.
 */
import { describe, expect, it } from "vitest";
import { DefaultAgentRuntime } from "@ai-orchestrator/agent-runtime";
import { createDefaultConnectorRegistry } from "@ai-orchestrator/connector-sdk";
import { createDefaultMCPRegistry, type MCPServerAdapter } from "@ai-orchestrator/mcp-sdk";
import { EchoProviderAdapter, ProviderRegistry, type LLMProviderAdapter, type ProviderCallRequest } from "@ai-orchestrator/provider-sdk";
import type { ChatMessage, Workflow, WorkflowEdge, WorkflowNode } from "@ai-orchestrator/shared";
import { executeWorkflow, type WorkflowExecutionDependencies } from "./executor";

function node(id: string, type: string, config: Record<string, unknown> = {}, name = id): WorkflowNode {
  return { id, type: type as WorkflowNode["type"], name, position: { x: 0, y: 0 }, config };
}

function workflow(id: string, nodes: WorkflowNode[], edges: Array<Omit<WorkflowEdge, "id">>): Workflow {
  return { id, name: `Workflow ${id}`, schemaVersion: "1.0.0", workflowVersion: 1, projectId: "default", nodes, edges: edges.map((edge, index) => ({ id: `e${index}`, ...edge })) };
}

class RecordingProvider implements LLMProviderAdapter {
  readonly definition = { id: "recording", label: "Recording", supportsTools: true, configSchema: {} };
  readonly requests: ProviderCallRequest[] = [];
  async generate(request: ProviderCallRequest) {
    this.requests.push(request);
    return { content: "ok", toolCalls: [] };
  }
  userMessage(index = 0): string {
    return this.requests[index]?.messages.find((message: ChatMessage) => message.role === "user")?.content ?? "";
  }
}

function crmAdapter(invoked: Array<{ tool: string; args: Record<string, unknown> }>): MCPServerAdapter {
  return {
    definition: { id: "crm-mcp", label: "CRM", description: "Test CRM", configSchema: {}, authSchema: {} },
    async discoverTools() {
      return [
        { serverId: "crm-mcp", serverLabel: "CRM", name: "update_contact", description: "Update a contact", inputSchema: { type: "object", properties: { email: { type: "string" } } } },
        {
          serverId: "crm-mcp",
          serverLabel: "CRM",
          name: "find_contact",
          description: "Find a contact",
          inputSchema: { type: "object", properties: { q: { type: "string" } } },
          annotations: { readOnlyHint: true }
        }
      ];
    },
    async invokeTool(toolName: string, args: Record<string, unknown>) {
      invoked.push({ tool: toolName, args });
      return { ok: true, output: { found: "Ada Lovelace" } };
    }
  } as unknown as MCPServerAdapter;
}

function deps(input: { provider?: LLMProviderAdapter; workflows?: Workflow[]; readOnlyTools?: string[]; invoked?: Array<{ tool: string; args: Record<string, unknown> }> } = {}): WorkflowExecutionDependencies {
  const providerRegistry = new ProviderRegistry();
  providerRegistry.register(new EchoProviderAdapter());
  if (input.provider) providerRegistry.register(input.provider);
  const mcpRegistry = createDefaultMCPRegistry();
  mcpRegistry.register(crmAdapter(input.invoked ?? []));
  return {
    providerRegistry,
    connectorRegistry: createDefaultConnectorRegistry(),
    mcpRegistry,
    agentRuntime: new DefaultAgentRuntime(),
    resolveSecret: async () => undefined,
    loadWorkflow: (id) => input.workflows?.find((entry) => entry.id === id),
    resolveRegisteredMcpServer: (id: string) => {
      if (id !== "crm_registry") throw new Error(`unknown registry server ${id}`);
      return { serverId: "crm-mcp", label: "CRM", connection: {} };
    },
    loadMcpToolPolicy: () => ({
      rules: [],
      classifications: (input.readOnlyTools ?? []).map((toolName) => ({ registryServerId: "crm_registry", toolName, readOnly: true }))
    })
  };
}

const webhookToLlm = (config: Record<string, unknown> = {}) =>
  workflow(
    "wf-llm",
    [node("in", "webhook_input"), node("llm", "llm_call", { provider: { providerId: "recording", model: "m" }, ...config }), node("out", "output")],
    [
      { source: "in", target: "llm" },
      { source: "llm", target: "out" }
    ]
  );

describe("LLM Call: the prompt comes from what reached the node", () => {
  it("sends a webhook's body when the node has no Prompt and the body has no prompt field", async () => {
    const provider = new RecordingProvider();
    const result = await executeWorkflow({ workflow: webhookToLlm(), webhookPayload: { ticket: "My printer is on fire", customer: "Ada", session_id: "s-1" }, triggerType: "webhook" }, deps({ provider }));
    expect(result.status).toBe("success");
    expect(provider.userMessage()).toContain("My printer is on fire");
    expect(provider.userMessage()).toContain('"customer": "Ada"');
    // The run's session is not content.
    expect(provider.userMessage()).not.toContain("session_id");
  });

  it("sends a webhook's message field as it is", async () => {
    const provider = new RecordingProvider();
    const result = await executeWorkflow({ workflow: webhookToLlm(), webhookPayload: { message: "Where is my order?" }, triggerType: "webhook" }, deps({ provider }));
    expect(result.status).toBe("success");
    expect(provider.userMessage()).toBe("Where is my order?");
  });

  it("renders the node's own Prompt against its input, over the run's prompt", async () => {
    const provider = new RecordingProvider();
    const result = await executeWorkflow(
      { workflow: webhookToLlm({ promptTemplate: "Triage this ticket: {{ticket}}" }), webhookPayload: { ticket: "Printer jam" }, userPrompt: "ignored" },
      deps({ provider })
    );
    expect(result.status).toBe("success");
    expect(provider.userMessage()).toBe("Triage this ticket: Printer jam");
  });

  it("uses the run's prompt (the editor's Run input) when the node has no Prompt", async () => {
    const provider = new RecordingProvider();
    const flow = workflow("wf-manual", [node("start", "manual_trigger"), node("llm", "llm_call", { provider: { providerId: "recording", model: "m" } })], [{ source: "start", target: "llm" }]);
    const result = await executeWorkflow({ workflow: flow, userPrompt: "Summarize our refund policy" }, deps({ provider }));
    expect(result.status).toBe("success");
    expect(provider.userMessage()).toBe("Summarize our refund policy");
  });

  it("fails with a fix, without calling the model, when nothing gives it a prompt", async () => {
    const provider = new RecordingProvider();
    const flow = workflow("wf-empty", [node("start", "manual_trigger"), node("llm", "llm_call", { provider: { providerId: "recording", model: "m" } }, "Classify")], [{ source: "start", target: "llm" }]);
    const result = await executeWorkflow({ workflow: flow }, deps({ provider }));
    expect(result.status).toBe("error");
    expect(result.error).toContain("Classify has no prompt to send");
    expect(result.error).toContain("Run input");
    expect(provider.requests).toEqual([]);
  });

  it("fails rather than send an empty message when the Prompt renders empty", async () => {
    const provider = new RecordingProvider();
    const result = await executeWorkflow({ workflow: webhookToLlm({ promptTemplate: "{{missing}}" }), webhookPayload: {} }, deps({ provider }));
    expect(result.status).toBe("error");
    expect(provider.requests).toEqual([]);
  });
});

describe("Agent: an empty prompt falls back to the run's prompt", () => {
  it("sends the run's prompt when the agent's template renders empty", async () => {
    const provider = new RecordingProvider();
    const flow = workflow(
      "wf-agent",
      [
        node("start", "manual_trigger"),
        node("agent", "agent_orchestrator", { userPromptTemplate: "{{question}}", maxIterations: 2, toolCallingEnabled: true }),
        node("model", "llm_call", { provider: { providerId: "recording", model: "m" } })
      ],
      [
        { source: "start", target: "agent" },
        { source: "agent", sourceHandle: "chat_model", target: "model" }
      ]
    );
    const result = await executeWorkflow({ workflow: flow, userPrompt: "What is MCP?" }, deps({ provider }));
    expect(result.status).toBe("success");
    expect(provider.userMessage()).toBe("What is MCP?");
  });
});

/** Webhook → Agent (Echo) with the given tool nodes on its tool port. */
function echoAgent(tools: WorkflowNode[]): Workflow {
  return workflow(
    "wf-echo-agent",
    [
      node("in", "webhook_input"),
      node("agent", "agent_orchestrator", { userPromptTemplate: "{{message}}", maxIterations: 4, toolCallingEnabled: true }),
      node("model", "llm_call", { provider: { providerId: "echo", model: "demo" } }),
      ...tools,
      node("out", "output", { responseTemplate: "{{answer}}" })
    ],
    [
      { source: "in", target: "agent" },
      { source: "agent", target: "out" },
      { source: "agent", sourceHandle: "chat_model", target: "model" },
      ...tools.map((tool) => ({ source: "agent", sourceHandle: "tool", target: tool.id }))
    ]
  );
}

type AgentOutput = { answer?: string; steps?: Array<{ requestedTools: Array<{ name: string; arguments: Record<string, unknown> }> }> };
const agentOutput = (result: Awaited<ReturnType<typeof executeWorkflow>>) => result.nodeResults.find((entry) => entry.nodeId === "agent")?.output as AgentOutput;
const requested = (result: Awaited<ReturnType<typeof executeWorkflow>>) => (agentOutput(result).steps ?? []).flatMap((step) => step.requestedTools);

const crmTools = node("crm", "mcp_tool", { registryServerId: "crm_registry", toolName: "__all__" });

describe("Echo demo tool call: only tools L2M classifies read-only", () => {
  it("calls an admin-marked read-only tool once, with no invented arguments, then says it is a test model", async () => {
    const invoked: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const result = await executeWorkflow({ workflow: echoAgent([crmTools]), webhookPayload: { message: "Find the contact Ada" } }, deps({ readOnlyTools: ["find_contact"], invoked }));
    expect(result.status).toBe("success");
    expect(invoked).toEqual([{ tool: "find_contact", args: {} }]);
    expect(requested(result)).toHaveLength(1);
    const answer = agentOutput(result).answer ?? "";
    expect(answer).toContain("Demo tool call: Echo called crm-mcp__find_contact once");
    expect(answer).toContain("Ada Lovelace");
    expect(answer).toContain("Echo is a test model");
  });

  it("does not trust a server's own read-only hint: with no admin mark it calls nothing and says why", async () => {
    const invoked: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const result = await executeWorkflow({ workflow: echoAgent([crmTools]), webhookPayload: { message: "Find the contact Ada" } }, deps({ invoked }));
    expect(result.status).toBe("success");
    expect(invoked).toEqual([]);
    expect(requested(result)).toEqual([]);
    expect(agentOutput(result).answer).toContain("Echo made no demo tool call: none of the attached tools is read-only in L2M");
  });

  it("never calls a write tool, even when it is the only tool and matches the message", async () => {
    const invoked: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const writeOnly = node("crm", "mcp_tool", { registryServerId: "crm_registry", toolName: "update_contact" });
    const result = await executeWorkflow({ workflow: echoAgent([writeOnly]), webhookPayload: { message: "Update the contact" } }, deps({ readOnlyTools: ["find_contact"], invoked }));
    expect(result.status).toBe("success");
    expect(invoked).toEqual([]);
  });

  const child = (readOnly: boolean): Workflow =>
    workflow(
      "wf-child",
      [
        node("start", "sub_workflow_trigger", {
          description: "Look up an order's status.",
          inputSchema: { type: "object", properties: { order: { type: "string" } }, required: ["order"] },
          ...(readOnly ? { readOnly: true } : {})
        }),
        node("set", "set_node", { assignments: [{ key: "status", valueTemplate: "Order {{order}}: shipped" }] }),
        node("out", "output", { responseTemplate: "{{status}}" })
      ],
      [
        { source: "start", target: "set" },
        { source: "set", target: "out" }
      ]
    );
  const workflowTool = node("lookup", "workflow_tool", { workflowId: "wf-child", toolName: "look_up_order" });

  it("calls a read-only workflow tool, filling its one required text input with the user's own message", async () => {
    const result = await executeWorkflow({ workflow: echoAgent([workflowTool]), webhookPayload: { message: "order 1001" } }, deps({ workflows: [child(true)] }));
    expect(result.status).toBe("success");
    expect(requested(result)).toEqual([expect.objectContaining({ name: "l2m-workflow__look_up_order", arguments: { order: "order 1001" } })]);
    expect(agentOutput(result).answer).toContain("Order order 1001: shipped");
  });

  it("does not call a workflow tool whose trigger does not declare it read-only", async () => {
    const result = await executeWorkflow({ workflow: echoAgent([workflowTool]), webhookPayload: { message: "order 1001" } }, deps({ workflows: [child(false)] }));
    expect(result.status).toBe("success");
    expect(requested(result)).toEqual([]);
    expect(agentOutput(result).answer).toContain("Echo made no demo tool call");
  });
});
