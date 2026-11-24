import { describe, expect, it } from "vitest";
import {
  a2aAgentCardSchema,
  a2aCardUrlFor,
  a2aMessageInput,
  a2aMethodOf,
  a2aOutputParts,
  a2aTaskStateForExecution,
  a2aTriggerAuthMode,
  buildA2AAgentCard,
  fromLegacyMessage,
  isInterruptedTaskState,
  isTerminalTaskState,
  readA2ASendResult,
  readA2ATask,
  readTaskState,
  resolveA2AEndpoint,
  toLegacyStreamEvent,
  toLegacyTask,
  type A2ATask
} from "./a2a";
import { publicEntryMessage, unknownAuthMode } from "./public-entry";
import { isLiveEntryOff, liveEntryOffMessage } from "./definitions";
import { responseBoundaryForTrigger } from "./response-boundary";

describe("A2A methods", () => {
  it("reads 1.0 and 0.3 method names", () => {
    expect(a2aMethodOf("SendMessage")).toEqual({ kind: "send", legacy: false });
    expect(a2aMethodOf("SendStreamingMessage")).toEqual({ kind: "stream", legacy: false });
    expect(a2aMethodOf("GetTask")).toEqual({ kind: "get", legacy: false });
    expect(a2aMethodOf("CancelTask")).toEqual({ kind: "cancel", legacy: false });
    expect(a2aMethodOf("message/send")).toEqual({ kind: "send", legacy: true });
    expect(a2aMethodOf("message/stream")).toEqual({ kind: "stream", legacy: true });
    expect(a2aMethodOf("tasks/get")).toEqual({ kind: "get", legacy: true });
    expect(a2aMethodOf("tasks/cancel")).toEqual({ kind: "cancel", legacy: true });
    expect(a2aMethodOf("ListTasks")).toBeNull();
  });
});

describe("task states", () => {
  it("maps execution statuses to task states", () => {
    expect(a2aTaskStateForExecution("running")).toBe("TASK_STATE_WORKING");
    expect(a2aTaskStateForExecution("success")).toBe("TASK_STATE_COMPLETED");
    expect(a2aTaskStateForExecution("partial")).toBe("TASK_STATE_COMPLETED");
    expect(a2aTaskStateForExecution("error")).toBe("TASK_STATE_FAILED");
    expect(a2aTaskStateForExecution("canceled")).toBe("TASK_STATE_CANCELED");
    expect(a2aTaskStateForExecution("waiting_approval")).toBe("TASK_STATE_INPUT_REQUIRED");
  });

  it("reads both spellings and knows terminal and interrupted states", () => {
    expect(readTaskState("completed")).toBe("TASK_STATE_COMPLETED");
    expect(readTaskState("input-required")).toBe("TASK_STATE_INPUT_REQUIRED");
    expect(readTaskState("TASK_STATE_REJECTED")).toBe("TASK_STATE_REJECTED");
    expect(readTaskState("nonsense")).toBe("TASK_STATE_UNSPECIFIED");
    expect(isTerminalTaskState("TASK_STATE_CANCELED")).toBe(true);
    expect(isTerminalTaskState("TASK_STATE_WORKING")).toBe(false);
    expect(isInterruptedTaskState("TASK_STATE_AUTH_REQUIRED")).toBe(true);
  });
});

describe("0.3 shapes", () => {
  const task: A2ATask = {
    id: "t1",
    contextId: "c1",
    status: { state: "TASK_STATE_COMPLETED", message: { messageId: "m2", role: "ROLE_AGENT", parts: [{ text: "done" }] } },
    artifacts: [{ artifactId: "a1", name: "output", parts: [{ text: "hi" }, { data: { n: 1 } }] }]
  };

  it("writes a task with kinds and lowercase states, and reads it back", () => {
    const legacy = toLegacyTask(task);
    expect(legacy).toMatchObject({
      kind: "task",
      status: { state: "completed", message: { kind: "message", role: "agent", parts: [{ kind: "text", text: "done" }] } },
      artifacts: [{ parts: [{ kind: "text", text: "hi" }, { kind: "data", data: { n: 1 } }] }]
    });
    expect(readA2ATask(legacy)).toEqual(task);
  });

  it("marks the last status update final", () => {
    expect(toLegacyStreamEvent({ statusUpdate: { taskId: "t", contextId: "c", status: { state: "TASK_STATE_WORKING" } } })).toMatchObject({ kind: "status-update", final: false });
    expect(toLegacyStreamEvent({ statusUpdate: { taskId: "t", contextId: "c", status: { state: "TASK_STATE_FAILED" } } })).toMatchObject({ final: true, status: { state: "failed" } });
  });

  it("reads a 0.3 message with file parts", () => {
    const message = fromLegacyMessage({ kind: "message", messageId: "m", role: "user", parts: [{ kind: "text", text: "a" }, { kind: "file", file: { uri: "https://x/f.pdf", name: "f.pdf", mimeType: "application/pdf" } }] });
    expect(message).toMatchObject({ role: "ROLE_USER", parts: [{ text: "a" }, { url: "https://x/f.pdf", filename: "f.pdf", mediaType: "application/pdf" }] });
  });

  it("reads SendMessage results of either version", () => {
    expect(readA2ASendResult({ task: { id: "t", status: { state: "TASK_STATE_WORKING" } } })).toEqual({ task: { id: "t", status: { state: "TASK_STATE_WORKING" } } });
    expect(readA2ASendResult({ message: { messageId: "m", role: "ROLE_AGENT", parts: [{ text: "x" }] } })).toMatchObject({ message: { parts: [{ text: "x" }] } });
    expect(readA2ASendResult({ kind: "message", messageId: "m", role: "agent", parts: [{ kind: "text", text: "y" }] })).toMatchObject({ message: { role: "ROLE_AGENT" } });
    expect(readA2ASendResult({ kind: "task", id: "t", contextId: "c", status: { state: "completed" } })).toMatchObject({ task: { status: { state: "TASK_STATE_COMPLETED" } } });
    expect(readA2ASendResult({ nothing: true })).toBeNull();
  });
});

describe("agent cards", () => {
  it("builds a card with both interfaces and a bearer scheme unless public", () => {
    const card = buildA2AAgentCard({ name: "Research", description: "Answers.", endpointUrl: "https://l2m.example.com/a2a/research", skillId: "research", authMode: "api_key" });
    expect(card.supportedInterfaces).toEqual([
      { url: "https://l2m.example.com/a2a/research", protocolBinding: "JSONRPC", protocolVersion: "1.0" },
      { url: "https://l2m.example.com/a2a/research", protocolBinding: "JSONRPC", protocolVersion: "0.3" }
    ]);
    expect(card.capabilities).toEqual({ streaming: true, pushNotifications: false, extendedAgentCard: false });
    expect(card.securitySchemes).toMatchObject({ bearer: { httpAuthSecurityScheme: { scheme: "Bearer" } } });
    expect(card.securityRequirements).toEqual([{ schemes: { bearer: { list: [] } } }]);
    expect(card.skills[0]).toMatchObject({ id: "research", tags: ["workflow"] });
    const open = buildA2AAgentCard({ name: "R", description: "", endpointUrl: "http://h/a2a/r", skillId: "r", authMode: "public" });
    expect(open.securitySchemes).toBeUndefined();
    expect(a2aAgentCardSchema.safeParse(card).success).toBe(true);
  });

  it("picks the 1.0 JSON-RPC interface, else 0.3, else a 0.3 card's url", () => {
    const card = buildA2AAgentCard({ name: "R", description: "", endpointUrl: "http://h/a2a/r", skillId: "r", authMode: "public" });
    expect(resolveA2AEndpoint(a2aAgentCardSchema.parse(card))).toEqual({ url: "http://h/a2a/r", version: "1.0" });
    expect(resolveA2AEndpoint(a2aAgentCardSchema.parse({ name: "x", supportedInterfaces: [{ url: "http://h/v03", protocolBinding: "JSONRPC", protocolVersion: "0.3" }] }))).toEqual({ url: "http://h/v03", version: "0.3" });
    expect(resolveA2AEndpoint(a2aAgentCardSchema.parse({ name: "x", url: "http://h/rpc", protocolVersion: "0.3.0" }))).toEqual({ url: "http://h/rpc", version: "0.3" });
    expect(resolveA2AEndpoint(a2aAgentCardSchema.parse({ name: "x", supportedInterfaces: [{ url: "http://h/g", protocolBinding: "GRPC", protocolVersion: "1.0" }] }))).toBeNull();
  });

  it("adds the well-known card path to a base URL", () => {
    expect(a2aCardUrlFor("https://h/a2a/r")).toBe("https://h/a2a/r/.well-known/agent-card.json");
    expect(a2aCardUrlFor("https://h/a2a/r/")).toBe("https://h/a2a/r/.well-known/agent-card.json");
    expect(a2aCardUrlFor("https://h/cards/agent.json")).toBe("https://h/cards/agent.json");
  });
});

describe("content", () => {
  it("turns run output into parts", () => {
    expect(a2aOutputParts("hello")).toEqual([{ text: "hello" }]);
    expect(a2aOutputParts(null)).toEqual([]);
    expect(a2aOutputParts({ answer: "42", steps: 3 })).toEqual([{ text: "42" }, { data: { answer: "42", steps: 3 }, mediaType: "application/json" }]);
    expect(a2aOutputParts([1, 2])).toEqual([{ data: [1, 2], mediaType: "application/json" }]);
  });

  it("reads a message's text, data and files", () => {
    expect(
      a2aMessageInput({ messageId: "m", role: "ROLE_USER", parts: [{ text: "one" }, { text: "two" }, { data: { k: 1 } }, { url: "https://f", filename: "f.txt" }] })
    ).toEqual({ text: "one\n\ntwo", data: { k: 1 }, files: [{ url: "https://f", filename: "f.txt" }] });
  });
});

describe("the A2A trigger as a live entry point", () => {
  const node = (config: Record<string, unknown>) => ({ id: "a", type: "a2a_trigger", config });

  it("needs an API key unless set otherwise, and warns only when public", () => {
    expect(a2aTriggerAuthMode({})).toBe("api_key");
    expect(a2aTriggerAuthMode({ authMode: "bearer" })).toBe("bearer");
    expect(publicEntryMessage(node({ path: "p" }))).toBeNull();
    expect(publicEntryMessage(node({ authMode: "bearer" }))).toBeNull();
    expect(publicEntryMessage(node({ authMode: "public" }))).toMatch(/^Public A2A agent/);
    expect(publicEntryMessage(node({ authMode: "public", active: false }))).toBeNull();
    expect(unknownAuthMode(node({ authMode: "none" }))).toBe("none");
  });

  it("can be switched off and answers on the a2a response boundary", () => {
    expect(isLiveEntryOff(node({ active: false }))).toBe(true);
    expect(liveEntryOffMessage("a2a_trigger")).toMatch(/This A2A agent is turned off/);
    expect(responseBoundaryForTrigger("a2a")).toEqual({ surface: "a2a" });
  });
});
