/**
 * What a public caller (a webhook URL, a Chat trigger) receives as the run's output.
 *
 * A workflow with an Output node answers with that node's result, as it always has. A workflow without one answers
 * with the output of its last node, and a node that passes its input on (If, Switch, Filter...) carries the whole run
 * context: workflow variables, the system and user prompts, the model settings (`_provider` with its base URL), the
 * run's ids. That context stays in the run data; the caller gets the node's own fields only.
 */
import type { Workflow } from "@ai-orchestrator/shared";

/** The run context every node sees: never part of a reply built from a node's output. */
const RUN_CONTEXT_KEYS = new Set([
  "vars",
  "variables",
  "webhook",
  "system_prompt",
  "user_prompt",
  "session_id",
  "images",
  "trigger_type",
  "input_trigger_type",
  "trigger_node_id",
  "scheduled_at",
  "execution_id",
  "execution_custom_data",
  "workflow",
  "execution",
  "results",
  "parent_outputs"
]);

/** Engine bookkeeping on node outputs: the model settings, usage, branch routing. */
const INTERNAL_KEYS = new Set(["_provider", "_telemetry", "_branchHandle", "_branchHandleFallback"]);

function isInternalKey(key: string): boolean {
  return INTERNAL_KEYS.has(key) || key.startsWith("$") || key.startsWith("__");
}

/**
 * The output a public caller receives. Unchanged when the workflow has an Output node or the output is not an object;
 * otherwise without the run context, the engine's own keys and the copies of other nodes' outputs (keyed by node id).
 */
export function callerReplyOutput(workflow: Pick<Workflow, "nodes">, output: unknown): unknown {
  if (workflow.nodes.some((node) => node.type === "output")) return output;
  if (!output || typeof output !== "object" || Array.isArray(output)) return output;
  const nodeIds = new Set(workflow.nodes.map((node) => node.id));
  const reply: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(output as Record<string, unknown>)) {
    if (RUN_CONTEXT_KEYS.has(key) || isInternalKey(key) || nodeIds.has(key)) continue;
    reply[key] = value;
  }
  return reply;
}
