import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DefaultAgentRuntime } from "@ai-orchestrator/agent-runtime";
import { createDefaultConnectorRegistry } from "@ai-orchestrator/connector-sdk";
import { createDefaultMCPRegistry } from "@ai-orchestrator/mcp-sdk";
import { ProviderRegistry, type LLMProviderAdapter, type ProviderCallRequest } from "@ai-orchestrator/provider-sdk";
import type { Workflow, WorkflowEdge, WorkflowExecutionState, WorkflowNode } from "@ai-orchestrator/shared";
import { writeToolApprovalKey } from "./approval-gate-node";
import { describeEgressRequest, isEgressNodeType } from "./destination-guard";
import { executeWorkflow, resumeWorkflowExecution, type WorkflowExecutionDependencies } from "./executor";
import { validateWorkflowGraph } from "./validation";

/** A remote A2A 1.0 agent in this process: a card and a JSON-RPC endpoint that answers `Remote saw: <text>`. */
const received: Array<{ method: string; text: string; authorization: string | undefined }> = [];
let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/agent/.well-known/agent-card.json") {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          name: "Remote researcher",
          description: "Looks things up.",
          version: "1",
          supportedInterfaces: [{ url: `${base}/agent`, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
          capabilities: { streaming: false },
          defaultInputModes: ["text/plain"],
          defaultOutputModes: ["text/plain"],
          skills: []
        })
      );
      return;
    }
    let body = "";
    request.on("data", (chunk) => (body += String(chunk)));
    request.on("end", () => {
      const rpc = JSON.parse(body) as { id: string; method: string; params: { message?: { parts: Array<{ text?: string }> } } };
      const text = rpc.params.message?.parts.map((part) => part.text ?? "").join("") ?? "";
      received.push({ method: rpc.method, text, authorization: request.headers.authorization });
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: rpc.id,
          result: {
            task: {
              id: "remote-task",
              contextId: "remote-context",
              status: { state: "TASK_STATE_COMPLETED" },
              artifacts: [{ artifactId: "a", parts: [{ text: `Remote saw: ${text}` }, { data: { sources: 2 } }] }]
            }
          }
        })
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function node(id: string, type: string, config: Record<string, unknown> = {}, name = id): WorkflowNode {
  return { id, type: type as WorkflowNode["type"], name, position: { x: 0, y: 0 }, config };
}

function workflow(nodes: WorkflowNode[], edges: Array<Omit<WorkflowEdge, "id">>, extra: Partial<Workflow> = {}): Workflow {
  return { id: "wf-a2a", name: "A2A", schemaVersion: "1.0.0", workflowVersion: 1, nodes, edges: edges.map((edge, index) => ({ id: `e${index}`, ...edge })), ...extra };
}

/** The supervisor delegates once to the first delegate tool it is offered, then answers with what came back. */
class DelegatingProvider implements LLMProviderAdapter {
  readonly definition = { id: "boss", label: "Boss", supportsTools: true, configSchema: {} };
  readonly offered: string[][] = [];
  async generate(request: ProviderCallRequest) {
    this.offered.push((request.tools ?? []).map((tool) => `${tool.name}: ${tool.description}`));
    const tool = request.messages.find((message) => message.role === "tool");
    if (tool) return { content: `Final: ${String(tool.content)}`, toolCalls: [] };
    const delegate = request.tools?.find((entry) => entry.name.startsWith("delegate_to_"));
    return delegate ? { content: "", toolCalls: [{ id: "c1", name: delegate.name, arguments: { task_prompt: "find the 2025 numbers" } }] } : { content: "no tool", toolCalls: [] };
  }
}

function deps(input: { provider?: LLMProviderAdapter; paused?: WorkflowExecutionState[]; secrets?: Record<string, string>; outboundGuard?: WorkflowExecutionDependencies["outboundGuard"] } = {}): WorkflowExecutionDependencies {
  const providerRegistry = new ProviderRegistry();
  if (input.provider) providerRegistry.register(input.provider);
  return {
    providerRegistry,
    mcpRegistry: createDefaultMCPRegistry(),
    connectorRegistry: createDefaultConnectorRegistry(),
    agentRuntime: new DefaultAgentRuntime(),
    resolveSecret: async (ref) => (ref ? input.secrets?.[ref.secretId] : undefined),
    ...(input.outboundGuard ? { outboundGuard: input.outboundGuard } : {}),
    persistPausedExecution: async (paused) => {
      input.paused?.push(paused.state);
    }
  };
}

function outputOf(result: Awaited<ReturnType<typeof executeWorkflow>>, nodeId: string): unknown {
  return result.nodeResults.find((entry) => entry.nodeId === nodeId)?.output;
}

describe("A2A Agent as a step", () => {
  it("sends the rendered message with the secret as a bearer token and outputs the reply", async () => {
    received.length = 0;
    const wf = workflow(
      [node("in", "webhook_input"), node("remote", "a2a_agent", { cardUrl: `${base}/agent`, messageTemplate: "Question: {{user_prompt}}", secretRef: { secretId: "tok" } }), node("out", "output")],
      [{ source: "in", target: "remote" }, { source: "remote", target: "out" }]
    );
    const result = await executeWorkflow({ workflow: wf, webhookPayload: { user_prompt: "revenue?" } }, deps({ secrets: { tok: "s3cret" } }));
    expect(result.status, result.error).toBe("success");
    expect(outputOf(result, "remote")).toMatchObject({
      text: "Remote saw: Question: revenue?",
      state: "completed",
      taskId: "remote-task",
      contextId: "remote-context",
      data: { sources: 2 },
      agent: { name: "Remote researcher", url: `${base}/agent`, protocolVersion: "1.0" }
    });
    expect(received).toEqual([{ method: "SendMessage", text: "Question: revenue?", authorization: "Bearer s3cret" }]);
  });

  it("refuses a private address when the outbound policy denies private ranges", async () => {
    received.length = 0;
    const wf = workflow([node("in", "manual_trigger"), node("remote", "a2a_agent", { cardUrl: `${base}/agent`, messageTemplate: "hi" })], [{ source: "in", target: "remote" }]);
    const result = await executeWorkflow({ workflow: wf }, deps({ outboundGuard: { denyPrivate: true, allowlist: [] } }));
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/blocked|private|loopback|not allowed/i);
    expect(received).toHaveLength(0);
  });

  it("uses the in-process mock agent, and fails the node when the remote task fails", async () => {
    const ok = await executeWorkflow(
      { workflow: workflow([node("in", "manual_trigger"), node("remote", "a2a_agent", { cardUrl: "mock-a2a://echo" })], [{ source: "in", target: "remote" }]), userPrompt: "ping" },
      deps()
    );
    expect(ok.status, ok.error).toBe("success");
    expect(outputOf(ok, "remote")).toMatchObject({ text: "Echo: ping", state: "completed" });
    const asks = await executeWorkflow({ workflow: workflow([node("in", "manual_trigger"), node("remote", "a2a_agent", { cardUrl: "mock-a2a://ask", messageTemplate: "x" })], [{ source: "in", target: "remote" }]) }, deps());
    expect(outputOf(asks, "remote")).toMatchObject({ state: "input-required", text: "Which year do you mean?" });
    const failed = await executeWorkflow({ workflow: workflow([node("in", "manual_trigger"), node("remote", "a2a_agent", { cardUrl: "mock-a2a://fail", messageTemplate: "x" })], [{ source: "in", target: "remote" }]) }, deps());
    expect(failed.status).toBe("error");
    expect(failed.error).toMatch(/ended the task as failed/);
  });

  it("is validated: a card URL is needed, and it may be a supervisor's worker", () => {
    const wf = workflow(
      [node("sup", "supervisor_node", { maxIterations: 2 }), node("model", "llm_call", { provider: { providerId: "boss", model: "m" } }), node("remote", "a2a_agent", {})],
      [{ source: "sup", sourceHandle: "chat_model", target: "model" }, { source: "sup", sourceHandle: "worker", target: "remote" }]
    );
    const codes = validateWorkflowGraph(wf).issues.map((issue) => issue.code);
    expect(codes).toContain("missing_a2a_card_url");
    expect(codes).not.toContain("invalid_worker_attachment");
  });
});

describe("A2A Agent as a Supervisor worker", () => {
  function supervised(remoteConfig: Record<string, unknown>, settings?: Workflow["settings"]) {
    return workflow(
      [
        node("in", "webhook_input"),
        node("sup", "supervisor_node", { maxIterations: 3, userPromptTemplate: "{{user_prompt}}" }, "Lead"),
        node("model", "llm_call", { provider: { providerId: "boss", model: "m" } }),
        node("remote", "a2a_agent", { cardUrl: `${base}/agent`, ...remoteConfig }, "Researcher"),
        node("out", "output")
      ],
      [
        { source: "in", target: "sup" },
        { source: "sup", target: "out" },
        { source: "sup", sourceHandle: "chat_model", target: "model" },
        { source: "sup", sourceHandle: "worker", target: "remote" }
      ],
      settings ? { settings } : {}
    );
  }

  it("is offered as a delegate tool and sends the supervisor's task to the remote agent", async () => {
    received.length = 0;
    const provider = new DelegatingProvider();
    const result = await executeWorkflow({ workflow: supervised({ toolDescription: "Researches market numbers." }), webhookPayload: { user_prompt: "Report" } }, deps({ provider }));
    expect(result.status, result.error).toBe("success");
    expect(provider.offered[0]).toContain("delegate_to_Researcher: Researches market numbers.");
    expect(received).toEqual([{ method: "SendMessage", text: "find the 2025 numbers", authorization: undefined }]);
    expect(JSON.stringify(outputOf(result, "sup"))).toContain("Remote saw: find the 2025 numbers");
  });

  it("asks a person first under the write-tool gate, then calls once approved; read-only skips the gate", async () => {
    received.length = 0;
    const paused: WorkflowExecutionState[] = [];
    const gated = supervised({}, { writeToolApproval: { enabled: true } });
    const first = await executeWorkflow({ workflow: gated, executionId: "exec-a2a", webhookPayload: { user_prompt: "Report" } }, deps({ provider: new DelegatingProvider(), paused }));
    expect(first.status).toBe("waiting_approval");
    expect(received).toHaveLength(0);
    const handoff = paused[0]!.approvalHandoff;
    expect(handoff?.kind === "rerun" ? handoff.approvalKey : "").toBe(writeToolApprovalKey("sup", "a2a:remote", "delegate_to_Researcher", { task_prompt: "find the 2025 numbers" }));
    expect(first.output).toMatchObject({ approvalMessage: "Agent 'Lead' wants to call the write tool 'delegate_to_Researcher' on 'A2A agent Researcher'." });
    const done = await resumeWorkflowExecution({ executionId: "exec-a2a", state: paused[0]!, decision: "approve" }, deps({ provider: new DelegatingProvider() }));
    expect(done.status, done.error).toBe("success");
    expect(received).toHaveLength(1);

    received.length = 0;
    const readOnly = await executeWorkflow({ workflow: supervised({ readOnly: true }, { writeToolApproval: { enabled: true } }), webhookPayload: { user_prompt: "Report" } }, deps({ provider: new DelegatingProvider() }));
    expect(readOnly.status, readOnly.error).toBe("success");
    expect(received).toHaveLength(1);
  });
});

describe("A2A Agent under destination rules", () => {
  it("is an egress node: the check sees the agent's host and the message, and may rewrite only the message", () => {
    expect(isEgressNodeType("a2a_agent")).toBe(true);
    const request = describeEgressRequest(
      { id: "remote", type: "a2a_agent", name: "Remote" },
      { cardUrl: "https://agents.example.com/research", messageTemplate: "Card {{card}}" },
      { card: "4111 1111 1111 1111" }
    );
    expect(request).toMatchObject({
      refs: [{ kind: "http", host: "agents.example.com" }],
      channel: "egress",
      content: { url: "https://agents.example.com/research", message: "Card 4111 1111 1111 1111" },
      sent: { kind: "a2a", message: "Card 4111 1111 1111 1111" }
    });
    expect(request!.apply({ url: "https://agents.example.com/research", message: "Card [redacted]" })).toEqual({ kind: "a2a", message: "Card [redacted]" });
    expect(request!.apply({ url: "https://elsewhere.example.com/", message: "x" })).toBeNull();
  });
});
