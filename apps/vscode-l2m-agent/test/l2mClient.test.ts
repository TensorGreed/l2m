import { afterEach, describe, expect, it, vi } from "vitest";
import { L2MClient } from "../src/l2mClient";
import { L2MRunError } from "../src/runFailure";
import type { L2MAgentConfig } from "../src/protocol";

describe("L2MClient streaming", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the final result from a successful SSE stream", async () => {
    stubFetchStream([
      sse("execution_started", { executionId: "ex-1" }),
      sse("result", { status: "success", output: { message: "ok" } })
    ]);

    const result = await createClient().execute({
      sessionId: "s1",
      userPrompt: "hello"
    });

    expect(result).toEqual({ status: "success", output: { message: "ok" } });
  });

  it("throws when a stream reports an error after the result event", async () => {
    stubFetchStream([
      sse("result", { status: "error", error: "workflow failed" }),
      sse("error", { message: "workflow failed" })
    ]);

    await expect(createClient().execute({
      sessionId: "s1",
      userPrompt: "hello"
    })).rejects.toThrow("workflow failed");
  });

  it("reports a failed model call as a short readable error, with the run kept as details", async () => {
    const run = failedModelRun();
    stubFetchStream([
      sse("node_complete", { nodeId: "agent_1", status: "error" }),
      sse("result", run),
      sse("error", { message: run.error })
    ]);

    const error = await createClient().execute({ sessionId: "s1", userPrompt: "hello" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(L2MRunError);
    expect((error as L2MRunError).kind).toBe("model");
    expect((error as Error).message).toBe(
      'The model call failed: ollama answered 404: model "qwen2.5:7b" not found, try pulling it first. Check the chat model settings of workflow "wf-test" in L2M.'
    );
    expect((error as Error).message).not.toMatch(/success/i);
    expect((error as L2MRunError).details).toEqual(run);
  });

  it("says a node failed instead of completed in progress", async () => {
    stubFetchStream([
      sse("node_complete", { nodeId: "agent_1", status: "error" }),
      sse("node_complete", { nodeId: "webhook_1", status: "success" }),
      sse("result", { status: "success", nodeResults: [], output: { message: "ok" } })
    ]);
    const progress: string[] = [];

    await createClient().execute({ sessionId: "s1", userPrompt: "hello" }, { onProgress: (message) => progress.push(message) });

    expect(progress).toEqual(["agent_1 failed.", "Completed webhook_1."]);
  });

  it("does not show an older server's masked model failure as a successful answer", async () => {
    const legacy = {
      workflowId: "wf-test",
      status: "success",
      nodeResults: [
        {
          nodeId: "chat_model_1",
          status: "success",
          output: {
            reason: "attachment_consumed_by_agent",
            handle: "chat_model",
            usedByNodeId: "agent_1",
            details: { stopReason: "error", iterations: 0, answer: "Provider ollama request failed (404): {\"error\":\"model not found\"}" }
          }
        },
        { nodeId: "agent_1", status: "success", output: { answer: "Provider ollama request failed (404)", stopReason: "error" } },
        { nodeId: "output_1", status: "success", output: { result: "" } }
      ],
      output: { result: "" }
    };
    stubFetchStream([sse("result", legacy)]);

    await expect(createClient().execute({ sessionId: "s1", userPrompt: "hello" })).rejects.toThrow(
      'The model call failed: ollama answered 404: model not found. Check the chat model settings of workflow "wf-test" in L2M.'
    );
  });

  it("reads a failed run from the JSON route's 400 answer", async () => {
    const run = { ...failedModelRun(), selectedWorkflowId: "wf-coding" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(run), { status: 400, headers: { "content-type": "application/json" } })));

    const error = await createClient({ streamResponses: false })
      .execute({ sessionId: "s1", userPrompt: "hello" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(L2MRunError);
    expect((error as Error).message).toContain("The model call failed: ollama answered 404");
    expect((error as Error).message).toContain('workflow "wf-coding"');
  });

  it("names the failed node when a run fails outside the model call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(
        JSON.stringify({
          workflowId: "wf-test",
          status: "error",
          error: "HTTP request failed with 500",
          nodeResults: [{ nodeId: "http_1", status: "error", error: "HTTP request failed with 500" }]
        }),
        { status: 400 }
      ))
    );

    await expect(createClient({ streamResponses: false }).execute({ sessionId: "s1", userPrompt: "hello" })).rejects.toThrow(
      'The workflow "wf-test" failed at node "http_1": HTTP request failed with 500.'
    );
  });

  it("does not return a successful run without an answer as raw run JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ workflowId: "wf-test", status: "success", nodeResults: [], output: { result: "" } }), { status: 200 }))
    );

    await expect(createClient({ streamResponses: false }).execute({ sessionId: "s1", userPrompt: "hello" })).rejects.toThrow(
      'The workflow "wf-test" finished without an answer. Check its Output node in L2M.'
    );
  });

  it("keeps a plain error body's message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Invalid webhook payload" }), { status: 400 })));

    await expect(createClient({ streamResponses: false }).execute({ sessionId: "s1", userPrompt: "hello" })).rejects.toThrow(
      "Invalid webhook payload"
    );
  });

  it("sends webhook_path when workflowId is not configured", async () => {
    const fetchMock = stubFetchStream([
      sse("result", { status: "success", output: { message: "ok" } })
    ]);

    await createClient({ workflowId: "" }).execute({
      sessionId: "s1",
      userPrompt: "hello"
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(init?.body));
    expect(body.workflow_id).toBeUndefined();
    expect(body.webhook_path).toBe("vscode-l2m-agent");
  });
});

function failedModelRun() {
  const providerError = 'Provider ollama request failed (404): {"error":{"message":"model \\"qwen2.5:7b\\" not found, try pulling it first"}}';
  return {
    workflowId: "wf-test",
    status: "error",
    error: providerError,
    errorCategory: "unknown",
    nodeResults: [
      {
        nodeId: "chat_model_1",
        status: "success",
        output: {
          handle: "chat_model",
          usedByNodeId: "agent_1",
          details: { stopReason: "error", iterations: 0, answer: providerError }
        }
      },
      { nodeId: "agent_1", status: "error", error: providerError },
      { nodeId: "output_1", status: "skipped" }
    ]
  };
}

function createClient(overrides: Partial<L2MAgentConfig> = {}): L2MClient {
  const config: L2MAgentConfig = {
    apiBaseUrl: "http://localhost:4000",
    workflowId: "wf-test",
    webhookPath: "vscode-l2m-agent",
    authToken: "test-token",
    streamResponses: true,
    requestTimeoutMs: 30_000,
    maxContextChars: 60_000,
    maxFileChars: 12_000,
    maxGitDiffChars: 20_000,
    maxDiagnostics: 50,
    maxOpenEditors: 10,
    maxPinnedFiles: 8,
    nearbyLineCount: 40,
    recentTurnCount: 12,
    maxCompactedMemoryChars: 20_000,
    ...overrides
  };
  return new L2MClient(config);
}

function stubFetchStream(chunks: string[]): ReturnType<typeof vi.fn> {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });

  const fetchMock = vi.fn(async () => new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" }
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sse(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}
