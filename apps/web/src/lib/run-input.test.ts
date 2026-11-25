import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { loadRunInput, RUN_ASKS_FOR_INPUT, runInputFields, runInputPayload, runNeedsPrompt, saveRunInput, triggerSamplePrompt } from "./run-input";

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
  it("asks in the studio (the public demo answers a Run with its own notice instead)", () => {
    expect(RUN_ASKS_FOR_INPUT).toBe(true);
  });

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

  it("runs straight away when the Manual Trigger's test data supplies the prompt (a template's sample input)", () => {
    const agent = { type: "agent_orchestrator", config: { userPromptTemplate: "{{user_prompt}}" } };
    const trigger = (testData: unknown) => ({ type: "manual_trigger", config: { testData } });
    expect(triggerSamplePrompt([trigger({ user_prompt: "What time is it?" }), agent])).toBe("What time is it?");
    expect(runNeedsPrompt([trigger({ user_prompt: "What time is it?" }), agent])).toBe(false);
    // Test data typed as JSON text counts too; an empty or missing prompt does not.
    expect(runNeedsPrompt([trigger('{"user_prompt":"hi"}'), agent])).toBe(false);
    expect(runNeedsPrompt([trigger({ user_prompt: "  " }), agent])).toBe(true);
    expect(runNeedsPrompt([trigger({ other: "x" }), agent])).toBe(true);
    expect(runNeedsPrompt([trigger("{not json"), agent])).toBe(true);
  });

  it("the featured templates that run without setup run on the first click", () => {
    const samples = path.resolve(__dirname, "../../../../samples/workflows");
    for (const file of ["mcp-agent-quickstart-flow.json", "supervisor-worker-swarm-flow.json"]) {
      const exported = JSON.parse(fs.readFileSync(path.join(samples, file), "utf8")) as { workflow: { nodes: Array<{ type: string; config?: unknown }> } };
      const nodes = exported.workflow.nodes.map((node) => ({ type: node.type, config: node.config }));
      expect(runNeedsPrompt(nodes), file).toBe(false);
      expect(triggerSamplePrompt(nodes), file).toBeTruthy();
    }
  });
});
