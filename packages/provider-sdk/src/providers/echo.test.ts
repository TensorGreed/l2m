import { describe, expect, it } from "vitest";
import { ECHO_DEMO_TOOL_CALL_ID, EchoProviderAdapter, echoDemoArguments } from "./echo";

const ctx = { resolveSecret: async () => undefined };

function makeRequest(messages: Array<{ role: string; content: string }>, prefix?: string) {
  return {
    provider: { providerId: "echo", model: "demo", ...(prefix === undefined ? {} : { prefix }) },
    messages: messages as never
  };
}

describe("EchoProviderAdapter", () => {
  it("echoes the last user message with the default 'Echo: ' prefix", async () => {
    const adapter = new EchoProviderAdapter();
    const result = await adapter.generate(
      makeRequest([
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello world" }
      ]),
      ctx
    );
    expect(result.content).toBe("Echo: Hello world");
    expect(result.toolCalls).toEqual([]);
  });

  it("uses a custom prefix when provided in provider config", async () => {
    const adapter = new EchoProviderAdapter();
    const result = await adapter.generate(
      makeRequest([{ role: "user", content: "ping" }], ">> "),
      ctx
    );
    expect(result.content).toBe(">> ping");
  });

  it("picks the most recent user message when there are multiple", async () => {
    const adapter = new EchoProviderAdapter();
    const result = await adapter.generate(
      makeRequest([
        { role: "user", content: "first" },
        { role: "assistant", content: "first reply" },
        { role: "user", content: "second" }
      ]),
      ctx
    );
    expect(result.content).toBe("Echo: second");
  });

  it("returns a friendly hint when no user message is present", async () => {
    const adapter = new EchoProviderAdapter();
    const result = await adapter.generate(
      makeRequest([{ role: "system", content: "system only" }]),
      ctx
    );
    expect(result.content).toMatch(/no user message/i);
    expect(result.toolCalls).toEqual([]);
  });

  it("never emits tool calls without tools (a plain LLM Call)", async () => {
    const adapter = new EchoProviderAdapter();
    const result = await adapter.generate(
      makeRequest([{ role: "user", content: "use a tool" }]),
      ctx
    );
    expect(result.toolCalls).toEqual([]);
  });

  it("testConnection always succeeds (it's in-process)", async () => {
    const adapter = new EchoProviderAdapter();
    const result = await adapter.testConnection!();
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/built in/i);
  });

  it("registry definition has supportsTools and the right id/label", () => {
    const adapter = new EchoProviderAdapter();
    expect(adapter.definition.id).toBe("echo");
    expect(adapter.definition.label).toMatch(/echo/i);
    expect(adapter.definition.supportsTools).toBe(true);
  });
});

describe("Echo demo tool call (an agent's tools)", () => {
  const time = { name: "get_current_time", description: "Get the current time", inputSchema: { type: "object", properties: { tz: { type: "string" } } } };
  const search = {
    name: "search_docs",
    description: "Search the help docs",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
  };
  const deleteAll = { name: "delete_everything", description: "Delete all records", inputSchema: { type: "object", properties: {} } };
  const agentRequest = (messages: Array<Record<string, unknown>>, tools: unknown[], readOnly?: string[]) => ({
    provider: { providerId: "echo", model: "demo" },
    messages: messages as never,
    tools: tools as never,
    ...(readOnly ? { options: { demoReadOnlyTools: readOnly } } : {})
  });

  it("makes one labelled call to the read-only tool that best matches the message", async () => {
    const result = await new EchoProviderAdapter().generate(agentRequest([{ role: "user", content: "search the docs for refunds" }], [time, search], ["get_current_time", "search_docs"]), ctx);
    expect(result.toolCalls).toEqual([{ id: ECHO_DEMO_TOOL_CALL_ID, name: "search_docs", arguments: { query: "search the docs for refunds" } }]);
    expect(result.content).toMatch(/Echo test model: demo call to search_docs/);
  });

  it("never calls a tool the request does not list as read-only, however well it matches", async () => {
    const result = await new EchoProviderAdapter().generate(agentRequest([{ role: "user", content: "delete everything" }], [deleteAll], []), ctx);
    expect(result.toolCalls).toEqual([]);
    expect(result.content).toContain("Echo made no demo tool call: none of the attached tools is read-only in L2M");
    expect(result.content).toContain("Echo is a test model");
  });

  it("calls nothing when no read-only list is given at all", async () => {
    const result = await new EchoProviderAdapter().generate(agentRequest([{ role: "user", content: "what time is it" }], [time]), ctx);
    expect(result.toolCalls).toEqual([]);
  });

  it("skips a read-only tool whose required inputs it cannot fill, and says so", async () => {
    const twoInputs = { name: "convert", description: "Convert", inputSchema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] } };
    const result = await new EchoProviderAdapter().generate(agentRequest([{ role: "user", content: "convert" }], [twoInputs], ["convert"]), ctx);
    expect(result.toolCalls).toEqual([]);
    expect(result.content).toContain("Echo never makes inputs up");
  });

  it("answers after the demo call with the tool's result, once, and says it is a test model", async () => {
    const result = await new EchoProviderAdapter().generate(
      agentRequest(
        [
          { role: "user", content: "what time is it" },
          { role: "assistant", content: "", toolCalls: [{ id: ECHO_DEMO_TOOL_CALL_ID, name: "get_current_time", arguments: {} }] },
          { role: "tool", toolCallId: ECHO_DEMO_TOOL_CALL_ID, name: "get_current_time", content: '{"iso":"2026-12-15T09:00:00Z"}' }
        ],
        [time],
        ["get_current_time"]
      ),
      ctx
    );
    expect(result.toolCalls).toEqual([]);
    expect(result.content).toContain("Echo: what time is it");
    expect(result.content).toContain("Demo tool call: Echo called get_current_time once");
    expect(result.content).toContain("2026-12-15T09:00:00Z");
    expect(result.content).toContain("Echo is a test model");
  });

  it("shows a JSON tool result readably: the envelope's output, with JSON text inside it parsed", async () => {
    const result = await new EchoProviderAdapter().generate(
      agentRequest(
        [
          { role: "user", content: "list orders" },
          { role: "assistant", content: "", toolCalls: [{ id: ECHO_DEMO_TOOL_CALL_ID, name: "list_orders", arguments: {} }] },
          { role: "tool", toolCallId: ECHO_DEMO_TOOL_CALL_ID, content: JSON.stringify({ ok: true, output: { orders: JSON.stringify([{ id: "ord_1", status: "pending" }]) } }) }
        ],
        [time],
        ["get_current_time"]
      ),
      ctx
    );
    expect(result.content).toContain('"id": "ord_1"');
    expect(result.content).not.toContain('\\"');
  });

  it("calls again for a new user message (a later chat turn)", async () => {
    const result = await new EchoProviderAdapter().generate(
      agentRequest(
        [
          { role: "user", content: "first" },
          { role: "tool", toolCallId: "x", content: "old" },
          { role: "assistant", content: "answer" },
          { role: "user", content: "what time is it" }
        ],
        [time],
        ["get_current_time"]
      ),
      ctx
    );
    expect(result.toolCalls.map((call) => call.name)).toEqual(["get_current_time"]);
  });
});

describe("echoDemoArguments", () => {
  it("leaves optional inputs out", () => {
    expect(echoDemoArguments({ type: "object", properties: { tz: { type: "string" } } }, "hi")).toEqual({});
  });
  it("uses a required input's default", () => {
    expect(echoDemoArguments({ type: "object", properties: { n: { type: "number", default: 3 } }, required: ["n"] }, "hi")).toEqual({ n: 3 });
  });
  it("fills one required free-text input with the message", () => {
    expect(echoDemoArguments({ type: "object", properties: { q: { type: "string" } }, required: ["q"] }, "hi")).toEqual({ q: "hi" });
  });
  it("refuses required inputs it would have to invent", () => {
    expect(echoDemoArguments({ type: "object", properties: { n: { type: "number" } }, required: ["n"] }, "hi")).toBeNull();
    expect(echoDemoArguments({ type: "object", properties: { mode: { type: "string", enum: ["a", "b"] } }, required: ["mode"] }, "hi")).toBeNull();
    expect(echoDemoArguments({ type: "object", properties: { email: { type: "string", format: "email" } }, required: ["email"] }, "hi")).toBeNull();
    expect(echoDemoArguments({ type: "object", properties: { a: { type: "string" }, b: { type: "string" } }, required: ["a", "b"] }, "hi")).toBeNull();
    expect(echoDemoArguments({ type: "object", properties: {}, required: ["ghost"] }, "hi")).toBeNull();
    expect(echoDemoArguments({ type: "object", properties: { q: { type: "string", maxLength: 2 } }, required: ["q"] }, "too long")).toBeNull();
  });
});
