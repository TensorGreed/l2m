import { describe, expect, it } from "vitest";
import { withAutoTypedSetFields } from "./legacy-behaviour";

const setNode = (assignments: unknown[]) => ({ id: "set", type: "set_node", config: { assignments } });

describe("withAutoTypedSetFields", () => {
  it("types the untyped Set fields of a workflow L2M never saved as auto, and keeps typed ones", () => {
    const workflow = { nodes: [setNode([{ key: "a", valueTemplate: "{{x}}" }, { key: "b", valueTemplate: "{{y}}", type: "string" }]), { id: "out", type: "output", config: {} }] };
    const next = withAutoTypedSetFields(workflow);
    expect(next.nodes[0]!.config).toEqual({ assignments: [{ key: "a", valueTemplate: "{{x}}", type: "auto" }, { key: "b", valueTemplate: "{{y}}", type: "string" }] });
    expect(next.nodes[1]).toBe(workflow.nodes[1]);
  });

  it("leaves a workflow L2M saved before (or an export of one) as it is", () => {
    const workflow = { createdAt: "2026-01-01T00:00:00.000Z", nodes: [setNode([{ key: "a", valueTemplate: "{{x}}" }])] };
    expect(withAutoTypedSetFields(workflow)).toBe(workflow);
  });

  it("returns the same workflow when nothing needs a type", () => {
    const workflow = { nodes: [setNode([{ key: "a", valueTemplate: "1", type: "number" }])] };
    expect(withAutoTypedSetFields(workflow)).toBe(workflow);
  });
});
