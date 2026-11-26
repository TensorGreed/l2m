/**
 * The API image carries the l2m command line, so `l2m audit verify` runs from a normal install
 * (`docker run … ghcr.io/tensorgreed/l2m l2m audit verify …`), not only from a checkout.
 * The image installs the CLI's own dependencies but not l2m-ner's (the ONNX runtime), so no command but
 * `l2m models` and the entity benchmark may load `@ai-orchestrator/ner` before it runs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(cliRoot, "../..");
const dockerfile = fs.readFileSync(path.join(repoRoot, "apps/api/Dockerfile"), "utf8");
const cliPackage = JSON.parse(fs.readFileSync(path.join(cliRoot, "package.json"), "utf8")) as { dependencies: Record<string, string> };

describe("the l2m CLI in the API image", () => {
  it("installs the CLI's production dependencies and puts l2m on the PATH", () => {
    expect(dockerfile).toContain("COPY packages/cli/package.json packages/cli/");
    expect(dockerfile).toMatch(/pnpm install --prod --frozen-lockfile [^\n]*--filter "@ai-orchestrator\/cli"/);
    expect(dockerfile).toContain('exec node /app/packages/cli/bin/l2m.mjs "$@"');
    expect(dockerfile).toContain("/usr/local/bin/l2m");
  });

  it("has every workspace package the CLI depends on, except l2m-ner", () => {
    const workspaceDeps = Object.entries(cliPackage.dependencies).filter(([, version]) => version.startsWith("workspace:"));
    for (const [name] of workspaceDeps) {
      if (name === "@ai-orchestrator/ner") continue;
      const folder = name.replace("@ai-orchestrator/", "");
      expect(dockerfile, name).toContain(`COPY packages/${folder}/package.json packages/${folder}/`);
    }
  });

  it("loads l2m-ner only inside the commands that need it", () => {
    const sources = fs.readdirSync(path.join(cliRoot, "src")).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
    for (const file of sources) {
      const text = fs.readFileSync(path.join(cliRoot, "src", file), "utf8");
      expect(text, file).not.toMatch(/^import [^\n]*from "@ai-orchestrator\/ner/m);
    }
  });
});
