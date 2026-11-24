/**
 * A2A — a workflow served as an Agent2Agent agent (a2a-routes.ts), and L2M calling L2M over A2A.
 */
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { Workflow, WorkflowNode } from "@ai-orchestrator/shared";
import { SecretService } from "./services/secret-service.js";
import {
  callAs,
  closeReleaseTestContext,
  createReleaseTestContext,
  enableReleaseGate,
  loginAs,
  saveVersion,
  testNode,
  type ReleaseTestContext
} from "./test-support/release.test-helper.js";

const opened: ReleaseTestContext[] = [];

async function context(): Promise<ReleaseTestContext> {
  const ctx = await createReleaseTestContext({ env: { OLLAMA_BASE_URL: "http://127.0.0.1:9" } });
  opened.push(ctx);
  return ctx;
}

afterEach(async () => {
  while (opened.length > 0) await closeReleaseTestContext(opened.pop()!);
});

function agentWorkflow(id: string, trigger: Record<string, unknown>, extra: { nodes?: WorkflowNode[]; answer?: string } = {}): Workflow {
  const nodes: WorkflowNode[] = [
    testNode("a2a", "a2a_trigger", { path: `agent-${id}`, agentDescription: "Answers questions.", ...trigger }),
    ...(extra.nodes ?? []),
    testNode("out", "output", { responseTemplate: extra.answer ?? "Answer to {{user_prompt}}" })
  ];
  const chain = nodes.map((node) => node.id);
  return {
    id,
    name: `Agent ${id}`,
    schemaVersion: "1.0.0",
    workflowVersion: 1,
    projectId: "default",
    nodes,
    edges: chain.slice(1).map((target, index) => ({ id: `e${index}`, source: chain[index]!, target }))
  } as Workflow;
}

async function bearerSecret(ctx: ReleaseTestContext, value: string): Promise<string> {
  return (await new SecretService(ctx.store, ctx.config.SECRET_MASTER_KEY_BASE64).createSecret({ name: `tok-${value}`, provider: "a2a", value })).secretId;
}

function send(text: string, extra: Record<string, unknown> = {}) {
  return { jsonrpc: "2.0", id: 1, method: "SendMessage", params: { message: { messageId: "m-1", role: "ROLE_USER", parts: [{ text }] }, ...extra } };
}

async function rpc(ctx: ReleaseTestContext, path: string, body: unknown, headers: Record<string, string> = {}) {
  return await ctx.app.inject({ method: "POST", url: `/a2a/${path}`, headers: { "content-type": "application/json", ...headers }, payload: body as object });
}

describe("the Agent Card", () => {
  it("names the agent, its JSON-RPC endpoints (1.0 and 0.3), streaming, and a bearer scheme", async () => {
    const ctx = await context();
    await ctx.store.upsertWorkflow(agentWorkflow("wf-card", { agentName: "Researcher" }));
    const response = await ctx.app.inject({ method: "GET", url: "/a2a/agent-wf-card/.well-known/agent-card.json", headers: { host: "l2m.test" } });
    expect(response.statusCode, response.body).toBe(200);
    const card = response.json();
    expect(card).toMatchObject({
      name: "Researcher",
      description: "Answers questions.",
      supportedInterfaces: [
        { url: "http://l2m.test/a2a/agent-wf-card", protocolBinding: "JSONRPC", protocolVersion: "1.0" },
        { url: "http://l2m.test/a2a/agent-wf-card", protocolBinding: "JSONRPC", protocolVersion: "0.3" }
      ],
      capabilities: { streaming: true, pushNotifications: false },
      securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: "Bearer" } } },
      skills: [{ id: "agent-wf-card", name: "Researcher" }],
      url: "http://l2m.test/a2a/agent-wf-card",
      protocolVersion: "0.3.0"
    });
    expect((await ctx.app.inject({ method: "GET", url: "/a2a/nope/.well-known/agent-card.json" })).statusCode).toBe(404);
  });
});

describe("the A2A endpoint", () => {
  it("SendMessage runs the workflow and answers a completed task; GetTask reads it back; the run is an a2a run", async () => {
    const ctx = await context();
    const secretId = await bearerSecret(ctx, "agent-token");
    await ctx.store.upsertWorkflow(agentWorkflow("wf-send", { authMode: "bearer", secretRef: { secretId } }));
    const response = await rpc(ctx, "agent-wf-send", send("the weather", { message: { messageId: "m-1", role: "ROLE_USER", contextId: "ctx-7", parts: [{ text: "the weather" }] } }), { authorization: "Bearer agent-token" });
    expect(response.statusCode, response.body).toBe(200);
    const task = response.json<{ result: { task: { id: string; contextId: string; status: { state: string }; artifacts: Array<{ parts: Array<{ text?: string }> }> } } }>().result.task;
    expect(task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(task.contextId).toBe("ctx-7");
    expect(task.artifacts[0]!.parts[0]!.text).toBe("Answer to the weather");

    const history = await ctx.store.getExecutionHistory(task.id);
    expect(history).toMatchObject({ status: "success", triggerType: "a2a", triggeredBy: "a2a-client", workflowId: "wf-send" });

    const read = await rpc(ctx, "agent-wf-send", { jsonrpc: "2.0", id: 2, method: "GetTask", params: { id: task.id } }, { authorization: "Bearer agent-token" });
    expect(read.json()).toMatchObject({ id: 2, result: { id: task.id, contextId: "ctx-7", status: { state: "TASK_STATE_COMPLETED" }, artifacts: [{ parts: [{ text: "Answer to the weather" }, { data: { result: "Answer to the weather" }, mediaType: "application/json" }] }] } });
    const unknown = await rpc(ctx, "agent-wf-send", { jsonrpc: "2.0", id: 3, method: "GetTask", params: { id: "not-a-task" } }, { authorization: "Bearer agent-token" });
    expect(unknown.json()).toMatchObject({ error: { code: -32001 } });
  });

  it("answers the 0.3 method names in 0.3 shapes", async () => {
    const ctx = await context();
    await ctx.store.upsertWorkflow(agentWorkflow("wf-legacy", { authMode: "public" }));
    const response = await rpc(ctx, "agent-wf-legacy", {
      jsonrpc: "2.0",
      id: "a",
      method: "message/send",
      params: { message: { kind: "message", messageId: "m", role: "user", parts: [{ kind: "text", text: "hi" }] } }
    });
    expect(response.json()).toMatchObject({ id: "a", result: { kind: "task", status: { state: "completed" }, artifacts: [{ parts: [{ kind: "text", text: "Answer to hi" }, { kind: "data", data: { result: "Answer to hi" } }] }] } });
    const id = response.json<{ result: { id: string } }>().result.id;
    expect((await rpc(ctx, "agent-wf-legacy", { jsonrpc: "2.0", id: "b", method: "tasks/get", params: { id } })).json()).toMatchObject({ result: { kind: "task", status: { state: "completed" } } });
  });

  it("SendStreamingMessage streams the task, its output and the final status over SSE", async () => {
    const ctx = await context();
    await ctx.store.upsertWorkflow(agentWorkflow("wf-stream", { authMode: "public" }));
    const response = await rpc(ctx, "agent-wf-stream", { ...send("streams"), method: "SendStreamingMessage" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/event-stream/);
    const events = response.body
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)) as { jsonrpc: string; id: number; result: Record<string, unknown> });
    expect(events.every((event) => event.jsonrpc === "2.0" && event.id === 1)).toBe(true);
    expect(Object.keys(events[0]!.result)).toEqual(["task"]);
    expect(events[0]!.result).toMatchObject({ task: { status: { state: "TASK_STATE_SUBMITTED" } } });
    expect(events[1]!.result).toMatchObject({ statusUpdate: { status: { state: "TASK_STATE_WORKING" } } });
    expect(events[2]!.result).toMatchObject({ artifactUpdate: { artifact: { parts: [{ text: "Answer to streams" }, { data: { result: "Answer to streams" } }] }, lastChunk: true } });
    expect(events.at(-1)!.result).toMatchObject({ statusUpdate: { status: { state: "TASK_STATE_COMPLETED" } } });

    // 0.3: bare objects with their kind, and `final` on the last status update.
    const legacy = await rpc(ctx, "agent-wf-stream", {
      jsonrpc: "2.0",
      id: 9,
      method: "message/stream",
      params: { message: { kind: "message", messageId: "m", role: "user", parts: [{ kind: "text", text: "x" }] } }
    });
    const last = legacy.body.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)) as { result: Record<string, unknown> }).at(-1)!;
    expect(last.result).toMatchObject({ kind: "status-update", final: true, status: { state: "completed" } });
  });

  it("returnImmediately answers a working task at once; GetTask then reports it completed", async () => {
    const ctx = await context();
    await ctx.store.upsertWorkflow(agentWorkflow("wf-async", { authMode: "public" }));
    const response = await rpc(ctx, "agent-wf-async", send("later", { configuration: { returnImmediately: true } }));
    const task = response.json<{ result: { task: { id: string; status: { state: string } } } }>().result.task;
    expect(task.status.state).toBe("TASK_STATE_WORKING");
    let state = "";
    for (let attempt = 0; attempt < 50 && state !== "TASK_STATE_COMPLETED"; attempt += 1) {
      const read = await rpc(ctx, "agent-wf-async", { jsonrpc: "2.0", id: 2, method: "GetTask", params: { id: task.id } });
      state = read.json<{ result?: { status: { state: string } } }>().result?.status.state ?? "";
      if (state !== "TASK_STATE_COMPLETED") await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(state).toBe("TASK_STATE_COMPLETED");
  });

  it("a run paused for Human Approval is input-required; CancelTask cancels it, and a second cancel is refused", async () => {
    const ctx = await context();
    await ctx.store.upsertWorkflow(
      agentWorkflow("wf-approve", { authMode: "public" }, { nodes: [testNode("approve", "human_approval", { approvalMessage: "Send it?", timeoutMinutes: 30 })] })
    );
    const response = await rpc(ctx, "agent-wf-approve", send("needs a person"));
    const task = response.json<{ result: { task: { id: string; status: { state: string; message: { parts: Array<{ text: string }> } } } } }>().result.task;
    expect(task.status.state).toBe("TASK_STATE_INPUT_REQUIRED");
    expect(task.status.message.parts[0]!.text).toMatch(/waiting for a person to approve/);
    expect((await rpc(ctx, "agent-wf-approve", { jsonrpc: "2.0", id: 2, method: "GetTask", params: { id: task.id } })).json()).toMatchObject({ result: { status: { state: "TASK_STATE_INPUT_REQUIRED" } } });
    const followUp = await rpc(ctx, "agent-wf-approve", send("yes", { message: { messageId: "m-2", role: "ROLE_USER", taskId: task.id, parts: [{ text: "yes" }] } }));
    expect(followUp.json()).toMatchObject({ error: { code: -32004 } });

    const canceled = await rpc(ctx, "agent-wf-approve", { jsonrpc: "2.0", id: 3, method: "CancelTask", params: { id: task.id } });
    expect(canceled.json()).toMatchObject({ result: { id: task.id, status: { state: "TASK_STATE_CANCELED" } } });
    expect((await ctx.store.getExecutionHistory(task.id))?.status).toBe("canceled");
    expect((await rpc(ctx, "agent-wf-approve", { jsonrpc: "2.0", id: 4, method: "CancelTask", params: { id: task.id } })).json()).toMatchObject({ error: { code: -32002 } });
  });

  it("refuses calls without the right credential: bearer secret, API key (the default), and unknown methods", async () => {
    const ctx = await context();
    const secretId = await bearerSecret(ctx, "right");
    await ctx.store.upsertWorkflow(agentWorkflow("wf-bearer", { authMode: "bearer", secretRef: { secretId } }));
    await ctx.store.upsertWorkflow(agentWorkflow("wf-nosecret", { authMode: "bearer" }));
    await ctx.store.upsertWorkflow(agentWorkflow("wf-key", {}));
    expect((await rpc(ctx, "agent-wf-bearer", send("x"))).statusCode).toBe(401);
    const wrong = await rpc(ctx, "agent-wf-bearer", send("x"), { authorization: "Bearer wrong" });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.headers["www-authenticate"]).toMatch(/Bearer/);
    expect(wrong.json()).toMatchObject({ jsonrpc: "2.0", id: 1, error: { message: "Invalid bearer token" } });
    expect((await rpc(ctx, "agent-wf-nosecret", send("x"), { authorization: "Bearer any" })).json()).toMatchObject({ error: { data: { code: "token_not_set" } } });

    // API key mode: no key, a made-up key, then a builder's real key.
    expect((await rpc(ctx, "agent-wf-key", send("x"))).statusCode).toBe(401);
    expect((await rpc(ctx, "agent-wf-key", send("x"), { authorization: "Bearer l2m_not_a_key" })).statusCode).toBe(401);
    const builder = await loginAs(ctx, "builder");
    const created = await callAs(ctx, "POST", "/api/auth/api-keys", builder.cookie, { name: "a2a caller" });
    expect(created.statusCode, created.body).toBeLessThan(300);
    const key = created.json<{ key: string }>().key;
    const ok = await rpc(ctx, "agent-wf-key", send("with a key"), { authorization: `Bearer ${key}` });
    expect(ok.json(), ok.body).toMatchObject({ result: { task: { status: { state: "TASK_STATE_COMPLETED" } } } });
    expect(await ctx.store.getExecutionHistory(ok.json<{ result: { task: { id: string } } }>().result.task.id)).toMatchObject({ triggeredBy: builder.email });
    // A session cookie never authorizes an A2A call.
    expect((await ctx.app.inject({ method: "POST", url: "/a2a/agent-wf-key", headers: { cookie: builder.cookie }, payload: send("x") })).statusCode).toBe(401);

    // A key limited to projects is not a credential here (as on every route that does not list it).
    const admin = await loginAs(ctx, "admin");
    const account = await callAs(ctx, "POST", "/api/service-accounts", admin.cookie, { name: "a2a-caller", role: "admin" });
    const accountId = account.json<{ serviceAccount: { id: string } }>().serviceAccount.id;
    await ctx.store.upsertProjectRole({ userId: accountId, projectId: "default", role: "project_admin" });
    const limited = await callAs(ctx, "POST", `/api/service-accounts/${accountId}/keys`, admin.cookie, { name: "limited", projects: ["default"] });
    expect(limited.statusCode, limited.body).toBe(201);
    const refused = await rpc(ctx, "agent-wf-key", send("x"), { authorization: `Bearer ${limited.json<{ key: string }>().key}` });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ error: { message: expect.stringMatching(/limited to projects/) } });

    expect((await rpc(ctx, "agent-wf-key", { jsonrpc: "2.0", id: 5, method: "ListTasks", params: {} }, { authorization: `Bearer ${key}` })).json()).toMatchObject({ error: { code: -32601 } });
    expect((await rpc(ctx, "agent-wf-key", { jsonrpc: "2.0", id: 6, method: "CreateTaskPushNotificationConfig", params: {} }, { authorization: `Bearer ${key}` })).json()).toMatchObject({ error: { code: -32003 } });
    expect((await rpc(ctx, "agent-wf-key", send("x"), { authorization: `Bearer ${key}`, "a2a-version": "2.0" })).json()).toMatchObject({ error: { code: -32009 } });
  });

  it("refuses a switched-off trigger and a deactivated workflow, telling only its editors why", async () => {
    const ctx = await context();
    await ctx.store.upsertWorkflow(agentWorkflow("wf-off", { authMode: "public", active: false }));
    const off = await rpc(ctx, "agent-wf-off", send("x"));
    expect(off.statusCode).toBe(404);
    expect(off.json()).toMatchObject({ error: { message: "A2A agent not found" } });
    expect((await ctx.app.inject({ method: "GET", url: "/a2a/agent-wf-off/.well-known/agent-card.json" })).statusCode).toBe(404);

    // Deactivating stops production of a workflow under a release gate (as for every other production entry point).
    await saveVersion(ctx, agentWorkflow("wf-gone", { authMode: "public" }));
    const admin = await loginAs(ctx, "admin");
    expect((await enableReleaseGate(ctx, admin.cookie, "wf-gone")).statusCode).toBe(200);
    expect((await callAs(ctx, "POST", "/api/workflows/wf-gone/deactivate", admin.cookie, {})).statusCode).toBe(200);
    const anonymous = await rpc(ctx, "agent-wf-gone", send("x"));
    expect(anonymous.statusCode).toBe(404);
    expect(anonymous.body).not.toMatch(/deactivated/);
    const editor = await ctx.app.inject({ method: "POST", url: "/a2a/agent-wf-gone", headers: { cookie: admin.cookie }, payload: send("x") });
    expect(editor.statusCode).toBe(409);
    expect(editor.body).toMatch(/deactivated/);
    expect((await ctx.store.listExecutionHistory({ page: 1, pageSize: 10 })).total).toBe(0);
  });
});

describe("L2M calling L2M over A2A", () => {
  it("a workflow's A2A Agent node calls another workflow's A2A endpoint over HTTP, with its token from a secret", async () => {
    const ctx = await context();
    const tokenSecret = await bearerSecret(ctx, "peer-token");
    await ctx.store.upsertWorkflow(agentWorkflow("wf-served", { authMode: "bearer", secretRef: { secretId: tokenSecret } }, { answer: "Served: {{user_prompt}}" }));
    await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    const port = (ctx.app.server.address() as AddressInfo).port;
    const caller: Workflow = {
      id: "wf-caller",
      name: "Caller",
      schemaVersion: "1.0.0",
      workflowVersion: 1,
      projectId: "default",
      nodes: [
        testNode("hook", "webhook_input", { path: "ask-peer", method: "POST" }),
        testNode("peer", "a2a_agent", { cardUrl: `http://127.0.0.1:${port}/a2a/agent-wf-served`, messageTemplate: "{{question}}", secretRef: { secretId: tokenSecret } }),
        testNode("out", "output", { responseTemplate: "Peer said: {{text}} ({{state}})" })
      ],
      edges: [
        { id: "e1", source: "hook", target: "peer" },
        { id: "e2", source: "peer", target: "out" }
      ]
    } as Workflow;
    await ctx.store.upsertWorkflow(caller);
    const response = await ctx.app.inject({ method: "POST", url: "/webhook/ask-peer", payload: { question: "who are you?" } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ output: { result: "Peer said: Served: who are you? (completed)" } });
    const runs = (await ctx.store.listExecutionHistory({ page: 1, pageSize: 10 })).items;
    expect(runs.map((run) => run.triggerType).sort()).toEqual(["a2a", "webhook"]);
  });

  it("the editor previews a remote card through the outbound guard (builders only)", async () => {
    const ctx = await context();
    await ctx.store.upsertWorkflow(agentWorkflow("wf-preview", { authMode: "public", agentName: "Previewed" }));
    await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    const port = (ctx.app.server.address() as AddressInfo).port;
    const builder = await loginAs(ctx, "builder");
    const preview = await callAs(ctx, "POST", "/api/a2a/card-preview", builder.cookie, { cardUrl: `http://127.0.0.1:${port}/a2a/agent-wf-preview` });
    expect(preview.json(), preview.body).toMatchObject({ name: "Previewed", protocolVersion: "1.0", streaming: true, endpoint: `http://127.0.0.1:${port}/a2a/agent-wf-preview` });
    const operator = await loginAs(ctx, "operator");
    expect((await callAs(ctx, "POST", "/api/a2a/card-preview", operator.cookie, { cardUrl: "http://127.0.0.1:1/x" })).statusCode).toBe(403);
    expect((await callAs(ctx, "POST", "/api/a2a/card-preview", builder.cookie, { cardUrl: "http://169.254.169.254/latest" })).statusCode).toBe(502);
  });
});
