/**
 * A webhook URL (production and test) answers a workflow without an Output node with its last node's own fields:
 * the run context (workflow variables, prompts, the model's base URL, the run's ids) stays in the run data.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Workflow } from "@ai-orchestrator/shared";
import { createApp } from "./app.js";
import { parseConfig, type AppConfig } from "./config.js";
import type { Store } from "./db/store.js";
import { AuthService } from "./services/auth-service.js";
import { SecretService } from "./services/secret-service.js";
import { openTestStore } from "./test-support/test-store.js";
import { webhookTestCookie } from "./test-support/webhook-test-caller.js";

interface TestContext { app: FastifyInstance; store: Store; authService: AuthService; config: AppConfig; tempDir: string }
const contexts: TestContext[] = [];
async function createTestContext(): Promise<TestContext> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ao-hook-reply-"));
  const store = await openTestStore(path.join(tempDir, "orchestrator.db"));
  await store.ensureDefaultProject();
  const config = parseConfig({
    LOG_LEVEL: "warn", SEED_SAMPLE_WORKFLOWS: "false", SECRET_MASTER_KEY_BASE64: crypto.randomBytes(32).toString("base64"),
    COOKIE_SECURE: "false", RATE_LIMIT_ENABLED: "false", MCP_PROBE_INTERVAL_MS: "0", OLLAMA_BASE_URL: "http://127.0.0.1:9",
    GIT_SYNC_WORKDIR: path.join(tempDir, "git")
  });
  const authService = new AuthService(store, config.SESSION_TTL_HOURS);
  const app = await createApp(config, store, new SecretService(store, config.SECRET_MASTER_KEY_BASE64), authService);
  await app.ready();
  const context = { app, store, authService, config, tempDir };
  contexts.push(context);
  return context;
}
afterEach(async () => {
  while (contexts.length > 0) {
    const c = contexts.pop()!;
    await c.app.close();
    try { await c.store.close(); } catch { /* closed by the app */ }
    fs.rmSync(c.tempDir, { recursive: true, force: true });
  }
});
const position = { x: 0, y: 0 };
function triage(): Workflow {
  return {
    id: "wf-triage", name: "Triage", schemaVersion: "1.0.0", workflowVersion: 1, projectId: "default",
    variables: { team: "support" },
    nodes: [
      { id: "hook", type: "webhook_input", name: "Hook", position, config: { path: "triage", method: "POST", authMode: "none" } },
      { id: "model", type: "llm_call", name: "Model", position, config: { provider: { providerId: "echo", model: "echo-1", baseUrl: "http://10.0.0.5:9999" }, promptTemplate: "Classify {{webhook.ticket}}" } },
      { id: "route", type: "switch_node", name: "Route", position, config: { switchValue: "{{model.text}}", cases: [{ value: "bug", label: "bug" }] } }
    ],
    edges: [ { id: "e1", source: "hook", target: "model" }, { id: "e2", source: "model", target: "route" } ]
  } as Workflow;
}
describe("webhook replies without an Output node", () => {
  it("answers /webhook and /webhook-test alike, without the run context", async () => {
    const context = await createTestContext();
    await context.store.upsertWorkflow(triage());
    const bodies: Array<Record<string, unknown>> = [];
    for (const route of ["/webhook/triage", "/webhook-test/triage"]) {
      const headers = route.startsWith("/webhook-test") ? { cookie: await webhookTestCookie(context) } : {};
      const response = await context.app.inject({ method: "POST", url: route, headers, payload: { ticket: "login broken" } });
      expect(response.statusCode, response.body).toBe(200);
      for (const leaked of ["10.0.0.5", "baseUrl", "_provider", "_telemetry", "\"vars\"", "system_prompt", "$workflow", "execution_id", "_branchHandle"]) {
        expect(response.body, `${route} leaks ${leaked}`).not.toContain(leaked);
      }
      bodies.push(response.json<{ output: Record<string, unknown> }>().output);
    }
    expect(bodies[0]).toEqual({ text: "Echo: Classify login broken", answer: "Echo: Classify login broken", toolCalls: [], matched: "default", evaluatedValue: "Echo: Classify login broken" });
    expect(bodies[1]).toEqual(bodies[0]);

    // The run data keeps the whole output.
    const runs = await context.store.listExecutionHistory({ workflowId: "wf-triage" });
    const run = await context.store.getExecutionHistory(runs.items[0]!.id);
    expect(JSON.stringify(run?.output)).toContain("10.0.0.5");
  });

  it("keeps an Output node's result as it is", async () => {
    const context = await createTestContext();
    const workflow = triage();
    workflow.nodes.push({ id: "out", type: "output", name: "Out", position, config: { responseTemplate: "{{model.text}}" } } as Workflow["nodes"][number]);
    workflow.edges.push({ id: "e3", source: "route", target: "out" });
    await context.store.upsertWorkflow(workflow);
    const response = await context.app.inject({ method: "POST", url: "/webhook/triage", payload: { ticket: "login broken" } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<{ output: unknown }>().output).toEqual({ result: "Echo: Classify login broken" });
  });
});
