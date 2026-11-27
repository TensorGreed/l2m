import { describe, expect, it } from "vitest";
import { isPlaceholderAddress, newNodeBaseConfig } from "./new-node-defaults";

describe("newNodeBaseConfig", () => {
  it("starts Summarize, Switch, the OpenAI-compatible model and Slack without the catalog's example values", () => {
    expect(
      newNodeBaseConfig("summarize_node", { fieldsToSummarize: [{ field: "amount", aggregation: "sum" }], fieldsToGroupBy: ["region"], inputKey: "items" })
    ).toEqual({ fieldsToSummarize: [{ field: "", aggregation: "sum" }], fieldsToGroupBy: [], inputKey: "items" });
    expect(newNodeBaseConfig("switch_node", { switchValue: "{{sentiment}}", cases: [{ value: "positive", label: "positive" }], defaultLabel: "default" })).toEqual({
      switchValue: "",
      cases: [],
      defaultLabel: "default"
    });
    expect(newNodeBaseConfig("openai_compatible_chat_model", { baseUrl: "http://localhost:1234/v1", model: "local-model", temperature: 0.2 })).toEqual({
      baseUrl: "",
      model: "",
      temperature: 0.2
    });
    expect(newNodeBaseConfig("slack_send_message", { authType: "webhook", webhookUrl: "https://hooks.slack.com/services/T000/B000/XXX" })).toEqual({
      authType: "webhook",
      webhookUrl: ""
    });
  });

  it("never changes the sample it is given", () => {
    const sample = { switchValue: "{{sentiment}}", cases: [{ value: "positive", label: "positive" }] };
    newNodeBaseConfig("switch_node", sample);
    expect(sample.switchValue).toBe("{{sentiment}}");
  });
});

describe("isPlaceholderAddress", () => {
  it("knows the catalog's example addresses", () => {
    for (const value of [
      "https://hooks.slack.com/services/T000/B000/XXX",
      "https://example.com",
      "https://api.example.com/v1/users/{{user_id}}",
      "smtp.example.com",
      "user@example.com",
      "https://agents.example.org/card.json"
    ]) {
      expect(isPlaceholderAddress(value), value).toBe(true);
    }
  });

  it("leaves real addresses, templates and other values alone", () => {
    for (const value of [
      "https://hooks.slack.com/services/T123ABC/B456/real",
      "https://myexample.com",
      "https://example.company.io",
      "alerts@acme.io",
      "{{webhook_url}}",
      "amount",
      "",
      42,
      undefined
    ]) {
      expect(isPlaceholderAddress(value), String(value)).toBe(false);
    }
  });
});
