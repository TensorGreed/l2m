/**
 * A workflow whose agent's model call fails (here: the model server answers 404 "model not found") is reported as a
 * failed run on the webhook execute routes the VS Code extension calls: HTTP 400 with `status: "error"` and the
 * provider's message on the JSON route, an error result on the stream. It used to be a success with an empty output.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Workflow, WorkflowExecutionResult } from "@ai-orchestrator/shared";
import { createApp } from "./app.js";
import { parseConfig } from "./config.js";
import type { Store } from "./db/store.js";
import { AuthService } from "./services/auth-service.js";
import { SecretService } from "./services/secret-service.js";
import { openTestStore } from "./test-support/test-store.js";

const MODEL_ERROR = 'model "qwen2.5:7b" not found, try pulling it first';

let modelServer: http.Server;
let app: FastifyInstance;
let store: Store;
let tempDir: string;
let cookie: string;

function codingAgentWorkflow(modelBaseUrl: string): Workflow {
  const file = path.resolve(__dirname, "../../../samples/workflows/vscode-l2m-coding-agent-flow.json");
  const workflow = (JSON.parse(fs.readFileSync(file, "utf8")) as { workflow: Workflow }).workflow;
  return {
    ...workflow,
    id: "wf-coding",
    projectId: "default",
    nodes: workflow.nodes.map((node) =>
      node.type === "llm_call"
        ? { ...node, config: { ...node.config, provider: { ...(node.config as { provider: object }).provider, baseUrl: modelBaseUrl } } }
        : node
    )
  };
}

beforeAll(async () => {
  modelServer = http.createServer((request, response) => {
    request.resume();
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: MODEL_ERROR } }));
  });
  await new Promise<void>((resolve) => modelServer.listen(0, "127.0.0.1", () => resolve()));
  const port = (modelServer.address() as AddressInfo).port;

  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ao-agent-model-failure-"));
  store = await openTestStore(path.join(tempDir, "orchestrator.db"));
  await store.ensureDefaultProject();
  const config = parseConfig({
    LOG_LEVEL: "warn",
    SEED_SAMPLE_WORKFLOWS: "false",
    SECRET_MASTER_KEY_BASE64: crypto.randomBytes(32).toString("base64"),
    COOKIE_SECURE: "false",
    RATE_LIMIT_ENABLED: "false",
    MCP_PROBE_INTERVAL_MS: "0",
    GIT_SYNC_WORKDIR: path.join(tempDir, "git")
  });
  const authService = new AuthService(store, config.SESSION_TTL_HOURS);
  app = await createApp(config, store, new SecretService(store, config.SECRET_MASTER_KEY_BASE64), authService);
  await app.ready();
  await store.upsertWorkflow(codingAgentWorkflow(`http://127.0.0.1:${port}/v1`));

  await authService.register({ email: "admin@example.com", password: "Admin-Pass-123!", role: "admin" });
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "admin@example.com", password: "Admin-Pass-123!" } });
  const raw = [login.headers["set-cookie"] ?? ""].flat();
  cookie = raw.find((value) => value.startsWith(`${config.SESSION_COOKIE_NAME}=`))!.split(";")[0]!;
});

afterAll(async () => {
  await app?.close();
  try {
    await store?.close();
  } catch {
    // Already closed by the app shutdown hooks.
  }
  await new Promise<void>((resolve) => modelServer.close(() => resolve()));
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const payload = { workflow_id: "wf-coding", user_prompt: "hello", system_prompt: "be brief", session_id: "s-1" };

describe("a failed agent model call on the webhook execute routes", () => {
  it("answers the JSON route with 400 and the provider's error", async () => {
    const response = await app.inject({ method: "POST", url: "/api/webhooks/execute", headers: { cookie }, payload });

    expect(response.statusCode, response.body).toBe(400);
    const run = response.json<WorkflowExecutionResult & { selectedWorkflowId: string }>();
    expect(run.status).toBe("error");
    expect(run.error).toContain("request failed (404)");
    expect(run.error).toContain("not found, try pulling it first");
    expect(run.selectedWorkflowId).toBe("wf-coding");
    expect(run.nodeResults.find((entry) => entry.nodeId === "agent_1")?.status).toBe("error");
    expect(run.nodeResults.find((entry) => entry.nodeId === "output_1")?.status).not.toBe("success");
  }, 60_000);

  it("ends the stream with an error result", async () => {
    const response = await app.inject({ method: "POST", url: "/api/webhooks/execute/stream", headers: { cookie }, payload });

    const resultEvent = response.body
      .split("\n\n")
      .find((block) => block.startsWith("event: result"));
    expect(resultEvent, response.body.slice(-2000)).toBeDefined();
    const run = JSON.parse(resultEvent!.split("\n").find((line) => line.startsWith("data:"))!.slice(5)) as WorkflowExecutionResult;
    expect(run.status).toBe("error");
    expect(run.error).toContain("not found, try pulling it first");
    expect(response.body).toContain("event: error");
  }, 60_000);
});
