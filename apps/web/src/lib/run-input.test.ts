import { afterEach, describe, expect, it } from "vitest";
import { loadRunInput, runInputFields, runInputPayload, runNeedsPrompt, saveRunInput } from "./run-input";

afterEach(() => {
  window.localStorage.clear();
});

describe("the editor's Run input", () => {
  it("starts empty: there is no built-in sample prompt", () => {
    expect(loadRunInput("wf-1")).toEqual({ prompt: "", systemPrompt: "" });
  });

  it("is remembered per workflow, and forgotten when cleared", () => {
    saveRunInput("wf-1", { prompt: "Summarize the ticket", systemPrompt: "" });
    expect(loadRunInput("wf-1")).toEqual({ prompt: "Summarize the ticket", systemPrompt: "" });
    expect(loadRunInput("wf-2").prompt).toBe("");
    saveRunInput("wf-1", { prompt: " ", systemPrompt: "" });
    expect(window.localStorage.getItem("l2m.runInput.wf-1")).toBeNull();
  });

  it("reads a damaged stored value as empty", () => {
    window.localStorage.setItem("l2m.runInput.wf-1", "{not json");
    expect(loadRunInput("wf-1")).toEqual({ prompt: "", systemPrompt: "" });
  });

  it("sends only typed fields that the workflow reads", () => {
    const fields = { prompt: true, systemPrompt: false };
    expect(runInputPayload({ prompt: "", systemPrompt: "" }, fields)).toEqual({});
    expect(runInputPayload({ prompt: "hi", systemPrompt: "Be brief" }, fields)).toEqual({ user_prompt: "hi" });
    expect(runInputPayload({ prompt: "hi", systemPrompt: "Be brief" }, { prompt: true, systemPrompt: true })).toEqual({ user_prompt: "hi", system_prompt: "Be brief" });
  });

  it("shows only for workflows that read a prompt", () => {
    expect(runInputFields([{ type: "http_request", config: {} }, { type: "output", config: {} }])).toEqual({ prompt: false, systemPrompt: false });
    expect(runInputFields([{ type: "agent_orchestrator", config: {} }]).prompt).toBe(true);
  });
});

describe("when Run asks for the input first", () => {
  it("asks for an agent on {{user_prompt}} behind a manual trigger", () => {
    expect(runNeedsPrompt([{ type: "manual_trigger", config: {} }, { type: "agent_orchestrator", config: { userPromptTemplate: "{{user_prompt}}" } }])).toBe(true);
    expect(runNeedsPrompt([{ type: "user_prompt", config: { text: "" } }, { type: "llm_call", config: {} }])).toBe(true);
  });

  it("runs straight away when the workflow brings its own input", () => {
    // A webhook brings its body; an agent with its own prompt; a prompt node with text; an LLM Call on its input.
    expect(runNeedsPrompt([{ type: "webhook_input", config: {} }, { type: "agent_orchestrator", config: {} }])).toBe(false);
    expect(runNeedsPrompt([{ type: "manual_trigger", config: {} }, { type: "agent_orchestrator", config: { userPromptTemplate: "{{question}}" } }])).toBe(false);
    expect(runNeedsPrompt([{ type: "text_input", config: { text: "hello" } }, { type: "llm_call", config: {} }])).toBe(false);
    expect(runNeedsPrompt([{ type: "manual_trigger", config: {} }, { type: "llm_call", config: {} }])).toBe(false);
  });
});
