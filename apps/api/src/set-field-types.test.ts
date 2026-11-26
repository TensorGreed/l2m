/**
 * Set fields saved without a type: a workflow that reaches L2M for the first time (POST /api/workflows with a new id,
 * an import of a file without createdAt) starts on the newer behaviour, so a number stays a number. A workflow L2M
 * saved before, and an export of one, keeps its fields as they are.
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

interface TestContext { app: FastifyInstance; store: Store; authService: AuthService; config: AppConfig; tempDir: string }
const contexts: TestContext[] = [];
async function createTestContext(): Promise<TestContext> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ao-set-types-"));
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

async function builderCookie(context: TestContext): Promise<string> {
  const email = "bea@example.com";
  const password = "bea-Pass-123!";
  await context.authService.register({ email, password, role: "builder" });
  const response = await context.app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
  const raw = response.headers["set-cookie"];
  const cookie = (Array.isArray(raw) ? raw : [raw ?? ""]).find((value) => value.startsWith(`${context.config.SESSION_COOKIE_NAME}=`));
  if (!cookie) throw new Error("No session cookie");
  return cookie.split(";")[0]!;
}

function pricing(id: string, extra: Partial<Workflow> = {}): Workflow {
  return {
    id,
    name: "Pricing",
    schemaVersion: "1.0.0",
    workflowVersion: 1,
    nodes: [
      { id: "start", type: "manual_trigger", name: "Start", position, config: {} },
      { id: "order", type: "set_node", name: "Order", position, config: { assignments: [{ key: "price", valueTemplate: "12", type: "number" }, { key: "expensive", valueTemplate: "false", type: "boolean" }] } },
      { id: "set", type: "set_node", name: "Set", position, config: { assignments: [{ key: "price", valueTemplate: "{{price}}" }, { key: "expensive", valueTemplate: "{{expensive}}" }, { key: "label", valueTemplate: "{{price}}", type: "string" }] } }
    ],
    edges: [{ id: "e1", source: "start", target: "order" }, { id: "e2", source: "order", target: "set" }],
    ...extra
  } as Workflow;
}

const setOutput = async (context: TestContext, cookie: string, id: string) => {
  const run = await context.app.inject({ method: "POST", url: `/api/workflows/${id}/execute`, headers: { cookie }, payload: {} });
  expect(run.statusCode, run.body).toBe(200);
  return run.json<{ nodeResults: Array<{ nodeId: string; output: unknown }> }>().nodeResults.find((node) => node.nodeId === "set")?.output;
};

describe("Set fields without a type", () => {
  it("are auto in a workflow created through the API or imported from a file L2M never saved", async () => {
    const context = await createTestContext();
    const cookie = await builderCookie(context);
    const created = await context.app.inject({ method: "POST", url: "/api/workflows", headers: { cookie }, payload: pricing("wf-created") });
    expect(created.statusCode, created.body).toBe(200);
    const stored = await context.store.getWorkflow("wf-created");
    expect((stored?.nodes[2]?.config as { assignments: Array<{ type?: string }> }).assignments.map((entry) => entry.type)).toEqual(["auto", "auto", "string"]);
    expect(await setOutput(context, cookie, "wf-created")).toEqual({ price: 12, expensive: false, label: "12" });

    const imported = await context.app.inject({ method: "POST", url: "/api/workflows/import", headers: { cookie }, payload: { json: JSON.stringify(pricing("wf-imported")) } });
    expect(imported.statusCode, imported.body).toBe(200);
    expect(await setOutput(context, cookie, "wf-imported")).toEqual({ price: 12, expensive: false, label: "12" });
  });

  it("keep their text values in a workflow L2M saved before, and in an export of one", async () => {
    const context = await createTestContext();
    const cookie = await builderCookie(context);
    await context.store.upsertWorkflow(pricing("wf-old"));
    // Saving the stored workflow again (the editor's PUT, or a POST to its id) keeps its fields as they are.
    const again = await context.app.inject({ method: "POST", url: "/api/workflows", headers: { cookie }, payload: pricing("wf-old") });
    expect(again.statusCode, again.body).toBe(200);
    expect(await setOutput(context, cookie, "wf-old")).toEqual({ price: "12", expensive: "false", label: "12" });

    const exported = { ...pricing("wf-exported"), createdAt: "2026-01-01T00:00:00.000Z" };
    const imported = await context.app.inject({ method: "POST", url: "/api/workflows/import", headers: { cookie }, payload: { json: JSON.stringify({ schemaVersion: "1.0.0", workflowVersion: 1, workflow: exported, exportedAt: "2026-02-01T00:00:00.000Z" }) } });
    expect(imported.statusCode, imported.body).toBe(200);
    expect(await setOutput(context, cookie, "wf-exported")).toEqual({ price: "12", expensive: "false", label: "12" });
  });
});
