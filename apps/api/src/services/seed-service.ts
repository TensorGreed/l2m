import fs from "node:fs";
import path from "node:path";
import { importWorkflowFromJson } from "@ai-orchestrator/workflow-engine";
import type { Store } from "../db/store.js";

const TEMPLATE_CATEGORY_MAP: Record<string, string> = {
  "basic-flow.json": "Getting Started",
  "mcp-agent-quickstart-flow.json": "Getting Started",
  "conditional-flow.json": "Logic & Control",
  "rag-flow.json": "RAG & AI",
  "rag-pinecone-flow.json": "RAG & AI",
  "structured-output-flow.json": "RAG & AI",
  "agentic-mcp-flow.json": "Agents",
  "supervisor-worker-swarm-flow.json": "Agents",
  "workflow-as-mcp-tool-flow.json": "Agents",
  "two-turn-report-code-helper-flow.json": "Agents",
  "vscode-l2m-coding-agent-flow.json": "Agents",
  "azure-openai-flow.json": "Cloud Integrations",
  "azure-connectors-demo-flow.json": "Cloud Integrations",
  "a2a-round-trip-flow.json": "Agents",
  "agent-clarify-flow.json": "Agents",
  "rag-hybrid-rerank-flow.json": "RAG & AI",
  "rag-knowledge-base-flow.json": "RAG & AI",
  "rag-with-citations-flow.json": "RAG & AI"
};

/** One line per built-in template: what it does and what it needs. Every template has one (the gallery shows it). */
const TEMPLATE_DESCRIPTION_MAP: Record<string, string> = {
  "basic-flow.json": "Text in, LLM Call, text out. Runs on the built-in Echo test model with no key; pick a real provider on the LLM Call when you are ready.",
  "mcp-agent-quickstart-flow.json": "An agent with a chat model and the built-in sample MCP server's time and calculator tools. Runs on Echo with no key: type a prompt next to Run, then pick a real model so the agent chooses tools.",
  "conditional-flow.json": "A webhook's message goes to an LLM Call, and an IF node routes a usable answer and an empty one to different outputs. Runs on Echo with no setup.",
  "rag-flow.json": "Retrieval-augmented generation over a few built-in documents. Runs on Echo with no setup; pick a real provider on the LLM Call for real answers.",
  "rag-pinecone-flow.json": "Chunks a document, retrieves from Pinecone with OpenAI embeddings and returns the matches. Needs Pinecone and OpenAI keys.",
  "structured-output-flow.json": "An LLM Call whose answer an Output Parser checks against a JSON schema. Needs a real chat model: Echo does not write JSON.",
  "agentic-mcp-flow.json": "A webhook-driven agent with a chat model, session memory and MCP tools. Runs on Echo with no setup; attach a real model to have the agent choose its tools.",
  "supervisor-worker-swarm-flow.json": "A Supervisor agent delegates to two worker agents (a researcher with knowledge-base tools and a computer with calculator and time tools); workers appear to it as tools. Runs on Echo with no key.",
  "workflow-as-mcp-tool-flow.json": "Exposes this whole workflow as an MCP tool (answer_from_kb) that other agents and MCP clients can call; an agent inside answers from a sample knowledge base.",
  "two-turn-report-code-helper-flow.json": "A chat helper that builds an MCP-backed report on the first turn and reuses it for follow-up Python code. Needs a chat model and an MCP server.",
  "vscode-l2m-coding-agent-flow.json": "The webhook workflow behind the L2M VS Code extension: chat replies with code blocks, patches and commands. Needs a chat model.",
  "azure-openai-flow.json": "Text in, a prompt template and an Azure OpenAI chat model, text out. Needs an Azure OpenAI deployment and key.",
  "azure-connectors-demo-flow.json": "Azure Storage, Cosmos DB, Monitor and AI Search connector nodes, with demo data when no Azure account is set.",
  "a2a-round-trip-flow.json": "Serves this workflow as an A2A agent and calls a built-in test agent over A2A from inside it. No model keys needed.",
  "agent-clarify-flow.json": "A chat agent that can stop and ask the user a clarifying question, then carries on with the answer from the next message. Needs an OpenAI key.",
  "branding-extract-flow.json": "Opens a website in a headless browser and has a model extract the brand name, logo, colors, font and tagline as JSON. Needs a chat model and Chromium.",
  "key-inventory-report-flow.json": "Builds a branded PDF report of encryption keys: lists keys from an MCP key service, charts them by cloud, algorithm and age, and styles the report from a brand website. Needs a chat model, the key service and Chromium.",
  "rag-hybrid-rerank-flow.json": "Answers from a knowledge base with hybrid keyword and vector search plus a reranker. Needs a knowledge base, a reranker key and a chat model.",
  "rag-knowledge-base-flow.json": "Answers a question from one of your knowledge bases. Pick the knowledge base on the RAG Retrieve node first; runs on Echo.",
  "rag-with-citations-flow.json": "Answers from a knowledge base with numbered citations that link back to the source passages. Needs a knowledge base and a chat model.",
  "report-with-charts-flow.json": "Turns sample data into three charts and an HTML report, rendered to PDF. Needs Chromium for the PDF step."
};

/** The author the gallery shows on built-in templates. */
export const BUILT_IN_TEMPLATE_AUTHOR = "L2M";

/** The gallery category of the starter templates (samples/starters). */
export const STARTER_TEMPLATE_CATEGORY = "Starters";

/**
 * Starter templates call the API's own sample data (sample-data-routes.ts). Their HTTP Request URLs name it with this
 * token, replaced with the API's base URL when the templates are seeded.
 */
export const STARTER_API_BASE_TOKEN = "$L2M_API_BASE";

/**
 * The base URL a workflow running in this API reaches the API itself at: the bound host (loopback when it binds every
 * interface) and port.
 */
export function selfApiBaseUrl(config: { API_HOST: string; API_PORT: number }): string {
  const host = config.API_HOST.trim();
  const reachable = !host || host === "0.0.0.0" || host === "::" || host === "[::]" ? "127.0.0.1" : host;
  const bracketed = reachable.includes(":") && !reachable.startsWith("[") ? `[${reachable}]` : reachable;
  return `http://${bracketed}:${config.API_PORT}`;
}

export interface SeedTemplateOptions {
  /** What the starters' `$L2M_API_BASE` becomes (default http://127.0.0.1:4000). */
  apiBaseUrl?: string;
}

function builtInTemplateId(fileName: string): string {
  return `builtin-${fileName.replace(/\.json$/i, "").replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

/**
 * Templates that should appear first in the gallery and carry a "Featured"
 * badge. The first card a new user sees must run without setup: the MCP agent
 * quickstart runs on the built-in Echo model and the in-process sample MCP server.
 */
export const FEATURED_TEMPLATE_IDS = new Set<string>([
  builtInTemplateId("mcp-agent-quickstart-flow.json")
]);

export async function seedWorkflowsIfEmpty(store: Store, workspaceRoot: string): Promise<void> {
  if (await store.countWorkflows() > 0) {
    return;
  }

  const sampleDir = path.resolve(workspaceRoot, "samples", "workflows");
  if (!fs.existsSync(sampleDir)) {
    return;
  }

  const files = fs.readdirSync(sampleDir).filter((file) => file.endsWith(".json"));
  for (const fileName of files) {
    const fullPath = path.join(sampleDir, fileName);
    const raw = fs.readFileSync(fullPath, "utf8");
    const workflow = importWorkflowFromJson(raw);
    await store.upsertWorkflow(workflow);
  }
}

export async function seedTemplatesIfEmpty(store: Store, workspaceRoot: string, options: SeedTemplateOptions = {}): Promise<void> {
  const existingTemplatesByName = new Map((await store.listTemplates()).map((template) => [template.name, template.id]));

  const sampleDir = path.resolve(workspaceRoot, "samples", "workflows");
  if (fs.existsSync(sampleDir)) {
    const files = fs.readdirSync(sampleDir).filter((file) => file.endsWith(".json"));
    for (const fileName of files) {
      const fullPath = path.join(sampleDir, fileName);
      const raw = fs.readFileSync(fullPath, "utf8");
      const workflow = importWorkflowFromJson(raw);
      const category = TEMPLATE_CATEGORY_MAP[fileName] ?? "General";
      const description = TEMPLATE_DESCRIPTION_MAP[fileName] ?? workflow.description ?? "";
      const tags: string[] = [category.toLowerCase().replace(/ & /g, "-").replace(/ /g, "-")];

      await store.upsertTemplate({
        id: existingTemplatesByName.get(workflow.name) ?? builtInTemplateId(fileName),
        name: workflow.name,
        description,
        category,
        tags,
        author: BUILT_IN_TEMPLATE_AUTHOR,
        workflowJson: raw,
        nodeCount: Array.isArray(workflow.nodes) ? workflow.nodes.length : 0
      });
    }
  }

  // Starter templates: everyday automations that run on built-in sample data, with no model, key or service to set up.
  const starterDir = path.resolve(workspaceRoot, "samples", "starters");
  if (fs.existsSync(starterDir)) {
    const apiBaseUrl = (options.apiBaseUrl ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
    const files = fs.readdirSync(starterDir).filter((file) => file.endsWith(".json")).sort();
    for (const fileName of files) {
      const raw = fs.readFileSync(path.join(starterDir, fileName), "utf8").split(STARTER_API_BASE_TOKEN).join(apiBaseUrl);
      const workflow = importWorkflowFromJson(raw);
      // Matched by its built-in id only, so a user's own template with the same name is never overwritten.
      await store.upsertTemplate({
        id: builtInTemplateId(fileName),
        name: workflow.name,
        description: workflow.description ?? "",
        category: STARTER_TEMPLATE_CATEGORY,
        tags: ["starter"],
        author: BUILT_IN_TEMPLATE_AUTHOR,
        workflowJson: raw,
        nodeCount: Array.isArray(workflow.nodes) ? workflow.nodes.length : 0
      });
    }
  }
}
