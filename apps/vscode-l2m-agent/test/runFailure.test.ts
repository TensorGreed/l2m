import { describe, expect, it } from "vitest";
import { errorBodyFailure, readableProviderMessage, runFailureOf } from "../src/runFailure";

const context = { workflowLabel: "vscode-l2m-agent" };

describe("readableProviderMessage", () => {
  it("pulls the provider's own message out of its error body", () => {
    expect(readableProviderMessage('Provider openai request failed (401): {"error":{"message":"Incorrect API key provided"}}')).toBe(
      "openai answered 401: Incorrect API key provided"
    );
  });

  it("keeps a body that is not JSON, and other messages as they are", () => {
    expect(readableProviderMessage("Provider ollama request failed (502): Bad Gateway")).toBe("ollama answered 502: Bad Gateway");
    expect(readableProviderMessage("Provider ollama request timed out after 30000ms.")).toBe("Provider ollama request timed out after 30000ms");
  });
});

describe("runFailureOf", () => {
  it("is null for a run with an answer, and for a body that is not a run", () => {
    expect(runFailureOf({ status: "success", nodeResults: [], output: { message: "Done" } }, context)).toBeNull();
    expect(runFailureOf({ message: "Done" }, context)).toBeNull();
    expect(runFailureOf("Done", context)).toBeNull();
  });

  it("reads a model timeout as a failed model call and falls back to the configured workflow", () => {
    const failure = runFailureOf({ status: "error", error: "Provider ollama request timed out after 30000ms", nodeResults: [] }, context);
    expect(failure?.kind).toBe("model");
    expect(failure?.message).toBe(
      'The model call failed: Provider ollama request timed out after 30000ms. Check the chat model settings of workflow "vscode-l2m-agent" in L2M.'
    );
  });

  it("reads a failure the chat model recorded for the failed agent as a failed model call", () => {
    const failure = runFailureOf(
      {
        status: "error",
        error: "connect ECONNREFUSED 127.0.0.1:9",
        nodeResults: [
          { nodeId: "model", status: "success", output: { handle: "chat_model", usedByNodeId: "agent", details: { stopReason: "error" } } },
          { nodeId: "agent", status: "error", error: "connect ECONNREFUSED 127.0.0.1:9" }
        ]
      },
      context
    );
    expect(failure?.kind).toBe("model");
    expect(failure?.message).toContain("The model call failed: connect ECONNREFUSED 127.0.0.1:9.");
  });
});

describe("errorBodyFailure", () => {
  it("falls back to the status line for an empty or non-JSON body", () => {
    expect(errorBodyFailure("", context, "L2M request failed (502)").message).toBe("L2M request failed (502)");
    expect(errorBodyFailure(null, context, "L2M request failed (502)").message).toBe("L2M request failed (502)");
  });
});
