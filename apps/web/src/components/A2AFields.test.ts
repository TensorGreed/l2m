import { describe, expect, it } from "vitest";
import { a2aAgentUrls } from "./A2AFields";
import { newNodeConfig } from "../lib/new-node-config";

describe("A2A trigger URLs", () => {
  it("gives the Agent Card URL and the endpoint under /a2a/<path>", () => {
    expect(a2aAgentUrls("https://l2m.example.com/", "/research-agent/")).toEqual({
      card: "https://l2m.example.com/a2a/research-agent/.well-known/agent-card.json",
      endpoint: "https://l2m.example.com/a2a/research-agent"
    });
    expect(a2aAgentUrls("https://l2m.example.com", "  ")).toBeNull();
  });

  it("starts a new trigger on its own path, with API key auth", () => {
    const config = newNodeConfig("a2a_trigger", { path: "research-agent", authMode: "api_key", agentDescription: "Answers research questions." }, () => "abc123");
    expect(config).toMatchObject({ path: "research-agent-abc123", authMode: "api_key", agentDescription: "" });
  });
});
