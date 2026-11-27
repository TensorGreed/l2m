import { describe, expect, it } from "vitest";
import { renderedEmptyFields } from "./rendered-empty";

describe("renderedEmptyFields", () => {
  it("names Set fields whose template filled nothing", () => {
    const config = {
      assignments: [
        { key: "name", valueTemplate: "{{customer.name}}" },
        { key: "missing", valueTemplate: "{{customer.nickname}}" },
        { key: "blank", valueTemplate: "" },
        { key: "meta.tag", valueTemplate: "{{tag}}" },
        { key: "auto", valueTemplate: "{{gone}}", type: "auto" }
      ]
    };
    expect(renderedEmptyFields("set_node", config, { name: "Ada", missing: "", blank: "", meta: { tag: "" }, auto: null })).toEqual(["missing", "meta.tag", "auto"]);
  });

  it("names an Output whose response template filled nothing", () => {
    expect(renderedEmptyFields("output", { responseTemplate: "{{answer}}" }, { result: "" })).toEqual(["result"]);
    expect(renderedEmptyFields("output", { responseTemplate: "{{answer}}", outputKey: "reply" }, { reply: "", result: "" })).toEqual(["reply"]);
    expect(renderedEmptyFields("output", { responseTemplate: "{{answer}}" }, { result: "hi" })).toEqual([]);
  });

  it("says nothing for other nodes, typed values or a missing output", () => {
    expect(renderedEmptyFields("http_request", { urlTemplate: "{{url}}" }, { body: "" })).toEqual([]);
    expect(renderedEmptyFields("set_node", { assignments: [{ key: "n", valueTemplate: "{{n}}" }] }, { n: 0 })).toEqual([]);
    expect(renderedEmptyFields("set_node", { assignments: [{ key: "n", valueTemplate: "{{n}}" }] }, undefined)).toEqual([]);
  });
});
