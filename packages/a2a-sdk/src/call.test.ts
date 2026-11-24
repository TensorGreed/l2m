import { describe, expect, it } from "vitest";
import { A2AClientError, callA2AAgent, createDefaultA2ARegistry, type A2AFetch } from "./index";

/** A remote agent answering in memory: a card at /.well-known/agent-card.json and a JSON-RPC endpoint at /rpc. */
function fakeAgent(options: { version: "1.0" | "0.3"; workingPolls?: number; token?: string; error?: { code: number; message: string } }) {
  const calls: Array<{ method: string; params: Record<string, unknown>; headers: Headers }> = [];
  let polls = 0;
  const fetch: A2AFetch = async (url, init) => {
    const headers = new Headers(init.headers);
    if (options.token && headers.get("authorization") !== `Bearer ${options.token}`) return new Response("{}", { status: 401 });
    if (url === "https://agent.test/.well-known/agent-card.json") {
      const card =
        options.version === "1.0"
          ? { name: "Remote", description: "A remote agent.", supportedInterfaces: [{ url: "/rpc", protocolBinding: "JSONRPC", protocolVersion: "1.0" }], skills: [] }
          : { name: "Remote", description: "Old agent.", url: "https://agent.test/rpc", protocolVersion: "0.3.0", skills: [] };
      return Response.json(card);
    }
    if (url !== "https://agent.test/rpc") return new Response("not found", { status: 404 });
    const body = JSON.parse(String(init.body)) as { id: string; method: string; params: Record<string, unknown> };
    calls.push({ method: body.method, params: body.params, headers });
    if (options.error) return Response.json({ jsonrpc: "2.0", id: body.id, error: options.error });
    const working = (options.workingPolls ?? 0) > polls;
    const legacy = options.version === "0.3";
    const task = (state: "working" | "completed") =>
      legacy
        ? { kind: "task", id: "t1", contextId: "c1", status: { state }, ...(state === "completed" ? { artifacts: [{ artifactId: "a", parts: [{ kind: "text", text: "the answer" }, { kind: "data", data: { score: 3 } }] }] } : {}) }
        : {
            id: "t1",
            contextId: "c1",
            status: { state: state === "working" ? "TASK_STATE_WORKING" : "TASK_STATE_COMPLETED" },
            ...(state === "completed" ? { artifacts: [{ artifactId: "a", parts: [{ text: "the answer" }, { data: { score: 3 } }] }] } : {})
          };
    if (body.method === "SendMessage" || body.method === "message/send") {
      const value = task(working ? "working" : "completed");
      return Response.json({ jsonrpc: "2.0", id: body.id, result: legacy ? value : { task: value } });
    }
    if (body.method === "GetTask" || body.method === "tasks/get") {
      polls += 1;
      return Response.json({ jsonrpc: "2.0", id: body.id, result: task((options.workingPolls ?? 0) > polls ? "working" : "completed") });
    }
    if (body.method === "CancelTask" || body.method === "tasks/cancel") {
      return Response.json({ jsonrpc: "2.0", id: body.id, result: { id: "t1", status: { state: "TASK_STATE_CANCELED" } } });
    }
    return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } });
  };
  return { fetch, calls };
}

describe("callA2AAgent over JSON-RPC", () => {
  it("speaks 1.0: SendMessage with the version header and a bearer token, and reads the task's artifacts", async () => {
    const agent = fakeAgent({ version: "1.0", token: "tok" });
    const result = await callA2AAgent(createDefaultA2ARegistry(), {
      cardUrl: "https://agent.test",
      text: "question",
      context: { fetch: agent.fetch, token: "tok" },
      timeoutMs: 5_000
    });
    expect(result).toMatchObject({ state: "completed", text: "the answer", data: { score: 3 }, taskId: "t1", contextId: "c1", agent: { name: "Remote", url: "https://agent.test/rpc", protocolVersion: "1.0" } });
    expect(agent.calls[0]).toMatchObject({ method: "SendMessage", params: { message: { role: "ROLE_USER", parts: [{ text: "question" }] }, configuration: { returnImmediately: false } } });
    expect(agent.calls[0]!.headers.get("A2A-Version")).toBe("1.0");
  });

  it("falls back to 0.3 for a 0.3 card", async () => {
    const agent = fakeAgent({ version: "0.3" });
    const result = await callA2AAgent(createDefaultA2ARegistry(), { cardUrl: "https://agent.test/.well-known/agent-card.json", text: "q", context: { fetch: agent.fetch }, timeoutMs: 5_000 });
    expect(result).toMatchObject({ state: "completed", text: "the answer" });
    expect(agent.calls[0]).toMatchObject({ method: "message/send", params: { message: { kind: "message", role: "user", parts: [{ kind: "text", text: "q" }] }, configuration: { blocking: true } } });
  });

  it("asks again while the task is working", async () => {
    const agent = fakeAgent({ version: "1.0", workingPolls: 2 });
    const result = await callA2AAgent(createDefaultA2ARegistry(), { cardUrl: "https://agent.test", text: "q", context: { fetch: agent.fetch }, timeoutMs: 5_000, pollInitialMs: 1, pollMaxMs: 2 });
    expect(result.state).toBe("completed");
    expect(agent.calls.map((call) => call.method)).toEqual(["SendMessage", "GetTask", "GetTask"]);
  });

  it("cancels and fails when the task outlives the timeout", async () => {
    const agent = fakeAgent({ version: "1.0", workingPolls: 1_000 });
    const error = await callA2AAgent(createDefaultA2ARegistry(), { cardUrl: "https://agent.test", text: "q", context: { fetch: agent.fetch }, timeoutMs: 60, pollInitialMs: 5, pollMaxMs: 5 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(A2AClientError);
    expect((error as A2AClientError).kind).toBe("timeout");
    expect(agent.calls.at(-1)?.method).toBe("CancelTask");
  });

  it("reports the agent's JSON-RPC error and an unreadable card", async () => {
    const failing = fakeAgent({ version: "1.0", error: { code: -32005, message: "Content type not supported" } });
    await expect(callA2AAgent(createDefaultA2ARegistry(), { cardUrl: "https://agent.test", text: "q", context: { fetch: failing.fetch }, timeoutMs: 5_000 })).rejects.toMatchObject({
      kind: "remote",
      code: -32005
    });
    const noCard: A2AFetch = async () => new Response("<html>", { status: 200 });
    await expect(callA2AAgent(createDefaultA2ARegistry(), { cardUrl: "https://agent.test", text: "q", context: { fetch: noCard }, timeoutMs: 5_000 })).rejects.toMatchObject({ kind: "card" });
    await expect(callA2AAgent(createDefaultA2ARegistry(), { cardUrl: "ftp://agent.test", text: "q", context: { fetch: noCard }, timeoutMs: 5_000 })).rejects.toMatchObject({ kind: "unsupported" });
  });
});

describe("the mock agent", () => {
  const fetch: A2AFetch = async () => {
    throw new Error("the mock never fetches");
  };

  it("echoes, asks, fails, and finishes a slow task after a poll", async () => {
    const registry = createDefaultA2ARegistry();
    expect(registry.list()).toEqual(["jsonrpc", "mock-a2a"]);
    expect(await callA2AAgent(registry, { cardUrl: "mock-a2a://echo", text: "hi", context: { fetch }, timeoutMs: 1_000 })).toMatchObject({ state: "completed", text: "Echo: hi" });
    expect(await callA2AAgent(registry, { cardUrl: "mock-a2a://ask", text: "hi", context: { fetch }, timeoutMs: 1_000 })).toMatchObject({ state: "input-required", text: "Which year do you mean?" });
    expect(await callA2AAgent(registry, { cardUrl: "mock-a2a://fail", text: "hi", context: { fetch }, timeoutMs: 1_000 })).toMatchObject({ state: "failed" });
    expect(await callA2AAgent(registry, { cardUrl: "mock-a2a://slow", text: "hi", context: { fetch }, timeoutMs: 1_000, pollInitialMs: 1 })).toMatchObject({ state: "completed", text: "Done after a while." });
  });
});
