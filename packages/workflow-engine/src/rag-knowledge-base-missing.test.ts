/**
 * A RAG Retrieve set to search a knowledge base fails when none is picked, or the one named does not exist (the
 * "RAG with Knowledge Base" template ships a placeholder id). It used to succeed with an empty context, and the model
 * then answered about nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createDefaultAgentRuntime } from "@ai-orchestrator/agent-runtime";
import { createDefaultConnectorRegistry } from "@ai-orchestrator/connector-sdk";
import { createDefaultMCPRegistry } from "@ai-orchestrator/mcp-sdk";
import { createDefaultProviderRegistry } from "@ai-orchestrator/provider-sdk";
import { workflowSchema, type Workflow } from "@ai-orchestrator/shared";
import { executeWorkflow } from "./executor";
import type { KnowledgeBaseStore } from "./rag-adapters";

const template = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../samples/workflows/rag-knowledge-base-flow.json");

function templateWorkflow(knowledgeBaseId: string): Workflow {
  const raw = JSON.parse(fs.readFileSync(template, "utf8")) as Workflow | { workflow: Workflow };
  const workflow = workflowSchema.parse("workflow" in raw ? raw.workflow : raw);
  const rag = workflow.nodes.find((node) => node.type === "rag_retrieve")!;
  rag.config = { ...(rag.config as Record<string, unknown>), vectorStoreConfig: { knowledgeBaseId } };
  return workflow;
}

const knowledgeBaseStore: KnowledgeBaseStore = {
  addKnowledgeBaseChunks: () => ({ inserted: 0, dimensions: 0 }),
  listKnowledgeBaseChunks: (id) => (id === "kb-docs" ? [{ id: "c1", sourceId: null, chunkIndex: 0, content: "Reset it under Settings.", metadata: null, vector: [1] }] : []),
  getKnowledgeBase: (id) => (id === "kb-docs" ? { id, embedderId: "token-embedder", dimensions: 1 } : null)
};

const dependencies = () => ({
  providerRegistry: createDefaultProviderRegistry(),
  connectorRegistry: createDefaultConnectorRegistry(),
  mcpRegistry: createDefaultMCPRegistry(),
  agentRuntime: createDefaultAgentRuntime(),
  resolveSecret: async () => undefined,
  knowledgeBaseStore
});

describe("RAG Retrieve on a knowledge base", () => {
  it("fails with a fix hint when the knowledge base the template names does not exist", async () => {
    const result = await executeWorkflow({ workflow: templateWorkflow("<your-kb-id>") }, dependencies());
    expect(result.status).toBe("error");
    const rag = result.nodeResults.find((node) => node.nodeId === "rag_1");
    expect(rag?.status).toBe("error");
    expect(rag?.error).toContain("'<your-kb-id>', which does not exist");
    expect(rag?.errorRemediation).toContain("pick one under Knowledge Base");
    expect(result.nodeResults.find((node) => node.nodeId === "llm_1")?.status ?? "not run").not.toBe("success");
  });

  it("fails when no knowledge base is picked", async () => {
    const result = await executeWorkflow({ workflow: templateWorkflow("  ") }, dependencies());
    expect(result.status).toBe("error");
    expect(result.nodeResults.find((node) => node.nodeId === "rag_1")?.error).toContain("none is picked");
  });

  it("searches a knowledge base that exists", async () => {
    const result = await executeWorkflow({ workflow: templateWorkflow("kb-docs") }, dependencies());
    expect(result.status, result.error).toBe("success");
    expect(JSON.stringify(result.nodeResults.find((node) => node.nodeId === "rag_1")?.output)).toContain("Reset it under Settings.");
  });
});
