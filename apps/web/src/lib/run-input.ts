/**
 * The editor's Run input: the prompt (and, optionally, the system prompt) a Run sends as `user_prompt` /
 * `system_prompt`. It is empty until someone types one, it is shown next to Run, and it is remembered per workflow in
 * this browser. Nothing is sent when it is empty: there is no built-in sample prompt.
 */
import { editorRunPrompts, type RunPromptNode } from "@ai-orchestrator/shared";

export interface RunInput {
  prompt: string;
  systemPrompt: string;
}

export const EMPTY_RUN_INPUT: RunInput = Object.freeze({ prompt: "", systemPrompt: "" });

const STORAGE_PREFIX = "l2m.runInput.";
/** Kept short: it is typed input for a test run, not a document. */
export const RUN_INPUT_MAX_CHARS = 20_000;

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The Run input remembered for a workflow, or an empty one. */
export function loadRunInput(workflowId: string): RunInput {
  try {
    const raw = storage()?.getItem(STORAGE_PREFIX + workflowId);
    if (!raw) return { ...EMPTY_RUN_INPUT };
    const parsed = JSON.parse(raw) as Partial<RunInput>;
    return {
      prompt: typeof parsed.prompt === "string" ? parsed.prompt.slice(0, RUN_INPUT_MAX_CHARS) : "",
      systemPrompt: typeof parsed.systemPrompt === "string" ? parsed.systemPrompt.slice(0, RUN_INPUT_MAX_CHARS) : ""
    };
  } catch {
    return { ...EMPTY_RUN_INPUT };
  }
}

/** Remembers a workflow's Run input; an empty one is forgotten. Storage failures are ignored (the input still works). */
export function saveRunInput(workflowId: string, input: RunInput): void {
  try {
    const store = storage();
    if (!store) return;
    if (!input.prompt.trim() && !input.systemPrompt.trim()) {
      store.removeItem(STORAGE_PREFIX + workflowId);
      return;
    }
    store.setItem(
      STORAGE_PREFIX + workflowId,
      JSON.stringify({ prompt: input.prompt.slice(0, RUN_INPUT_MAX_CHARS), systemPrompt: input.systemPrompt.slice(0, RUN_INPUT_MAX_CHARS) })
    );
  } catch {
    // Private windows and full storage: the input is just not remembered.
  }
}

/** Which Run input fields a workflow can read: the Input control shows only these. */
export function runInputFields(nodes: ReadonlyArray<RunPromptNode>): { prompt: boolean; systemPrompt: boolean } {
  const sends = editorRunPrompts(nodes);
  return { prompt: sends.sendUserPrompt, systemPrompt: sends.sendSystemPrompt };
}

function config(node: RunPromptNode): Record<string, unknown> {
  return node.config && typeof node.config === "object" && !Array.isArray(node.config) ? (node.config as Record<string, unknown>) : {};
}

/** Triggers whose runs bring their own content (a webhook body, a form, a tool call's arguments). */
const OWN_INPUT_TRIGGERS = new Set(["webhook_input", "form_trigger", "mcp_server_trigger", "a2a_trigger", "schedule_trigger"]);

/**
 * Whether a Run with an empty prompt would leave the workflow with nothing to work on, so Run asks for the input
 * first: the workflow reads the run's prompt as its main input (an agent whose prompt is `{{user_prompt}}`, an empty
 * User Prompt or Text Input node, a Prompt Template on `{{user_prompt}}`, a Chat Trigger) and no trigger brings content
 * of its own. A workflow that also works without it runs straight away.
 */
export function runNeedsPrompt(nodes: ReadonlyArray<RunPromptNode>): boolean {
  if (!runInputFields(nodes).prompt) return false;
  if (nodes.some((node) => OWN_INPUT_TRIGGERS.has(node.type))) return false;
  return nodes.some((node) => {
    const own = config(node);
    switch (node.type) {
      case "agent_orchestrator":
      case "supervisor_node":
        return typeof own.userPromptTemplate !== "string" || own.userPromptTemplate.includes("user_prompt");
      case "user_prompt":
      case "text_input":
        return typeof own.text !== "string" || !own.text.trim();
      case "prompt_template":
        return typeof own.template !== "string" || own.template.includes("user_prompt");
      case "chat_trigger":
        return true;
      default:
        return false;
    }
  });
}

/** What a Run sends from its input: only the fields the workflow reads, and only when they have text. */
export function runInputPayload(input: RunInput, fields: { prompt: boolean; systemPrompt: boolean }): { user_prompt?: string; system_prompt?: string } {
  return {
    ...(fields.prompt && input.prompt.trim() ? { user_prompt: input.prompt } : {}),
    ...(fields.systemPrompt && input.systemPrompt.trim() ? { system_prompt: input.systemPrompt } : {})
  };
}
