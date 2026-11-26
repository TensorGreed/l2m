import { describe, expect, it } from "vitest";
import type { Workflow } from "@ai-orchestrator/shared";
import { callerReplyOutput } from "./caller-reply-output.js";

const position = { x: 0, y: 0 };
const nodes = (types: string[]) => types.map((type, index) => ({ id: `n${index}`, type, name: type, position, config: {} })) as Workflow["nodes"];

describe("callerReplyOutput", () => {
  it("drops the run context, the engine's keys and other nodes' copies when there is no Output node", () => {
    const output = {
      vars: { team: "a" },
      system_prompt: "secret instructions",
      execution_id: "run-1",
      $workflow: { id: "wf" },
      _provider: { baseUrl: "http://10.0.0.5" },
      _telemetry: {},
      _branchHandle: "x",
      n0: { text: "copy" },
      text: "hello",
      _id: "kept: user data"
    };
    expect(callerReplyOutput({ nodes: nodes(["webhook_input", "switch_node"]) }, output)).toEqual({ text: "hello", _id: "kept: user data" });
  });

  it("keeps an Output node's result, and outputs that are not objects", () => {
    const output = { result: { vars: "a user field" } };
    expect(callerReplyOutput({ nodes: nodes(["webhook_input", "output"]) }, output)).toBe(output);
    expect(callerReplyOutput({ nodes: nodes(["webhook_input"]) }, "plain")).toBe("plain");
    expect(callerReplyOutput({ nodes: nodes(["webhook_input"]) }, [1, 2])).toEqual([1, 2]);
    expect(callerReplyOutput({ nodes: nodes(["webhook_input"]) }, undefined)).toBeUndefined();
  });
});
