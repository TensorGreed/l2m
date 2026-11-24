/**
 * Every shipped nginx config that proxies to the API must overwrite X-Forwarded-For, or a client-written value
 * passes through and TRUST_PROXY would take it as the client address.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");
const configs = ["ops/nginx/ai-orchestrator.conf", "apps/web/nginx.conf", "ops/loadtest/nginx.conf"];

function block(text: string, open: number): string {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    else if (text[index] === "}" && (depth -= 1) === 0) return text.slice(open + 1, index);
  }
  return text.slice(open + 1);
}

function forwarded(_text: string): RegExp {
  return /proxy_set_header\s+X-Forwarded-For\s+\$proxy_add_x_forwarded_for\s*;/i;
}

describe("shipped nginx configs", () => {
  for (const file of configs) {
    it(`${file} sets X-Forwarded-For in every proxy_pass location`, () => {
      const text = fs.readFileSync(path.join(root, file), "utf8").replace(/#.*$/gm, "");
      const servers = [...text.matchAll(/\bserver\s*\{/g)].map((match) => block(text, match.index! + match[0].length - 1));
      expect(servers.length).toBeGreaterThan(0);
      let proxied = 0;
      for (const server of servers) {
        const locations = [...server.matchAll(/\blocation\s+[^{]*\{/g)];
        const bodies = locations.map((match) => block(server, match.index! + match[0].length - 1));
        let outside = server;
        for (const body of bodies) outside = outside.replace(body, "");
        const inherited = forwarded(outside).test(outside);
        for (const body of bodies) {
          if (!/\bproxy_pass\b/.test(body)) continue;
          proxied += 1;
          const own = /proxy_set_header/.test(body);
          expect(own ? forwarded(body).test(body) : inherited, body.trim().slice(0, 60)).toBe(true);
        }
      }
      expect(proxied).toBeGreaterThan(0);
    });
  }
});

// The web image's start script (apps/web/nginx-api-upstream.sh): L2M_API_UPSTREAM points the studio's proxy at another
// API address; without it the shipped config (api:4000) is left as it is.
describe("web image API upstream (L2M_API_UPSTREAM)", () => {
  const script = path.join(root, "apps/web/nginx-api-upstream.sh");
  const shipped = fs.readFileSync(path.join(root, "apps/web/nginx.conf"), "utf8");

  function run(upstream: string | undefined, resolv = "nameserver 10.0.0.2\n"): { status: number | null; stderr: string; conf: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l2m-upstream-"));
    try {
      const conf = path.join(dir, "default.conf");
      const resolvConf = path.join(dir, "resolv.conf");
      fs.writeFileSync(conf, shipped);
      fs.writeFileSync(resolvConf, resolv);
      const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, L2M_API_UPSTREAM_CONF: conf, L2M_API_UPSTREAM_RESOLV_CONF: resolvConf };
      if (upstream !== undefined) env.L2M_API_UPSTREAM = upstream;
      const result = spawnSync("sh", [script], { env, encoding: "utf8" });
      return { status: result.status, stderr: result.stderr, conf: fs.readFileSync(conf, "utf8") };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it("ships api:4000 and proxies every API route through the l2m_api upstream", () => {
    expect(shipped).toMatch(/upstream l2m_api \{\n {2}server api:4000;\n\}/);
    const proxied = [...shipped.matchAll(/proxy_pass\s+([^;]+);/g)].map((match) => match[1]);
    expect(proxied.length).toBe(7);
    expect(new Set(proxied)).toEqual(new Set(["http://l2m_api"]));
    for (const route of ["/api/", "/webhook/", "/webhook-test/", "/mcp/", "/v1/", "/a2a/", "/health"]) {
      expect(shipped).toContain(`location ${route} {`);
    }
  });

  it("leaves the config untouched when unset or empty", () => {
    for (const value of [undefined, ""]) {
      const result = run(value);
      expect(result.status).toBe(0);
      expect(result.conf).toBe(shipped);
    }
  });

  it("points the upstream at host:port and looks the name up again through resolv.conf", () => {
    const result = run("l2m-api-x1y2:4000", "search example.internal\nnameserver 10.0.0.2\nnameserver fd00::53\n");
    expect(result.status).toBe(0);
    expect(result.conf).toContain(
      "upstream l2m_api {\n  zone l2m_api 64k;\n  resolver 10.0.0.2 [fd00::53] valid=10s;\n  server l2m-api-x1y2:4000 resolve;\n}\n# l2m-api-upstream:end"
    );
    expect(result.conf).not.toContain("server api:4000;");
    // Everything outside the block is unchanged.
    expect(result.conf.replace(/# l2m-api-upstream:begin[\s\S]*# l2m-api-upstream:end/, "")).toBe(
      shipped.replace(/# l2m-api-upstream:begin[\s\S]*# l2m-api-upstream:end/, "")
    );
  });

  it("uses a static server for an IPv4 address or when there is no DNS server", () => {
    expect(run("10.1.2.3:4000").conf).toContain("upstream l2m_api {\n  server 10.1.2.3:4000;\n}");
    expect(run("backend:8080", "").conf).toContain("upstream l2m_api {\n  server backend:8080;\n}");
  });

  it("refuses a value that is not host:port", () => {
    for (const value of ["api", "api:4000; evil", "http://api:4000", "api:0", "api:70000", "-api:4000", "api:4000\nserver x:1"]) {
      const result = run(value);
      expect(result.status, value).toBe(1);
      expect(result.stderr).toContain("L2M web:");
      expect(result.conf).toBe(shipped);
    }
  });
});
