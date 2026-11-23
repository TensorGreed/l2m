import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Store } from "../db/store.js";
import { openTestStore } from "../test-support/test-store.js";
import { SecretService } from "./secret-service.js";

const opened: Array<{ store: Store; dir: string }> = [];
afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.store.close();
    fs.rmSync(entry.dir, { recursive: true, force: true });
  }
});

async function service() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l2m-secret-redact-"));
  const store = await openTestStore(path.join(dir, "orchestrator.db"));
  opened.push({ store, dir });
  return new SecretService(store, crypto.randomBytes(32).toString("base64"));
}

describe("SecretService.redact", () => {
  it("keeps an MCP server's registry id readable on approval details", async () => {
    const secrets = await service();
    const id = `mcp_${crypto.randomUUID()}`;
    expect(id).toHaveLength(40);
    expect(secrets.redact({ toolName: "reply_to_ticket", server: id })).toEqual({ toolName: "reply_to_ticket", server: id });
  });

  it("still hides long tokens and known key shapes", async () => {
    const secrets = await service();
    const token = crypto.randomBytes(30).toString("base64url");
    expect(secrets.redact(token)).toBe("[REDACTED]");
    expect(secrets.redact(`mcp_${token}`)).toBe("[REDACTED]");
    expect(secrets.redact(`sk-${"a".repeat(24)}`)).toBe("[REDACTED]");
    // A record-id prefix does not make a token-shaped value safe: only a lowercase prefix plus a canonical UUID passes.
    expect(secrets.redact(`mcp_${crypto.randomUUID().toUpperCase()}`)).toBe("[REDACTED]");
    expect(secrets.redact(`mcp_${crypto.randomUUID()}x`)).toBe("[REDACTED]");
  });
});
