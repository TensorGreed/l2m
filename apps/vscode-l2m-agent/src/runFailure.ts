/**
 * Turns a failed L2M run into a short message for the chat, keeping the full run for the output channel.
 *
 * A run fails when L2M answers with `status: "error"` (HTTP 400 on the JSON route, a `result` or `error` event on the
 * stream). Older L2M servers reported a run whose agent's model call failed as a success, with the provider's error
 * text as the agent's answer and an empty workflow output: that shape is recognised too, so the extension never shows
 * such a run as an answer.
 */

export type L2MRunFailureKind = "model" | "workflow" | "empty";

export class L2MRunError extends Error {
  constructor(
    message: string,
    readonly kind: L2MRunFailureKind,
    /** The run (or error body) L2M returned, for the output channel. */
    readonly details: unknown
  ) {
    super(message);
    this.name = "L2MRunError";
  }
}

export interface RunFailureContext {
  /** How the workflow is named in messages: its id, or the webhook path when no id is configured. */
  workflowLabel: string;
}

/**
 * The failure a run result describes, or null when it carries an answer. `result` is the parsed body of the JSON
 * route or the payload of the stream's `result` event.
 */
export function runFailureOf(result: unknown, context: RunFailureContext): L2MRunError | null {
  const run = asRecord(result);
  if (!run) {
    return null;
  }
  const workflowLabel = workflowLabelOf(run, context);

  if (run.status === "error") {
    const raw = stringValue(run.error) || stringValue(run.message) || "the workflow run failed";
    const failedNodeId = failedNodeIdOf(run);
    const modelFailure = isModelFailure(raw, run, failedNodeId);
    return new L2MRunError(
      modelFailure ? modelFailureMessage(raw, workflowLabel) : workflowFailureMessage(raw, workflowLabel, failedNodeId),
      modelFailure ? "model" : "workflow",
      result
    );
  }

  if (!isRunEnvelope(run)) {
    return null;
  }

  // Older servers: the agent's model call failed, the run still says success.
  const maskedModelError = maskedModelErrorOf(run);
  if (maskedModelError && isEmptyOutput(run.output)) {
    return new L2MRunError(modelFailureMessage(maskedModelError, workflowLabel), "model", result);
  }

  if (run.status === "success" && isEmptyOutput(run.output)) {
    return new L2MRunError(
      `The workflow ${quote(workflowLabel)} finished without an answer. Check its Output node in L2M.`,
      "empty",
      result
    );
  }

  return null;
}

/**
 * The failure an error body (or an SSE `error` event) describes: a run envelope is read as a run, anything else by
 * its `error` / `message` text.
 */
export function errorBodyFailure(body: unknown, context: RunFailureContext, fallback: string): L2MRunError {
  const record = asRecord(body);
  if (record && (record.status === "error" || isRunEnvelope(record))) {
    const failure = runFailureOf({ ...record, status: "error" }, context);
    if (failure) {
      return failure;
    }
  }
  const raw = stringValue(body) || stringValue(record?.error) || stringValue(record?.message) || fallback;
  const modelFailure = isModelFailure(raw, record ?? {}, "");
  return new L2MRunError(
    modelFailure ? modelFailureMessage(raw, context.workflowLabel) : raw,
    modelFailure ? "model" : "workflow",
    body
  );
}

/** "Provider ollama request failed (404): {"error":{"message":"model not found"}}" → "ollama answered 404: model not found". */
export function readableProviderMessage(raw: string): string {
  const text = raw.trim();
  const match = /^Provider\s+([\w.-]+)\s+(?:[\w-]+\s+)?request failed \((\d{3})\):\s*([\s\S]*)$/i.exec(text);
  if (!match) {
    return stripTrailingPeriod(text);
  }
  const [, provider, status, body] = match;
  const detail = providerBodyMessage(body ?? "");
  return stripTrailingPeriod(`${provider} answered ${status}${detail ? `: ${detail}` : ""}`);
}

function modelFailureMessage(raw: string, workflowLabel: string): string {
  return `The model call failed: ${readableProviderMessage(raw)}. Check the chat model settings of workflow ${quote(workflowLabel)} in L2M.`;
}

function workflowFailureMessage(raw: string, workflowLabel: string, failedNodeId: string): string {
  const where = failedNodeId ? ` at node ${quote(failedNodeId)}` : "";
  return `The workflow ${quote(workflowLabel)} failed${where}: ${stripTrailingPeriod(raw.trim())}.`;
}

const MODEL_ERROR_PATTERNS = [
  /^Provider\s+[\w.-]+\s+(?:[\w-]+\s+)?request failed/i,
  /^Provider\s+[\w.-]+\b[^.]*\btimed out\b/i,
  /\bmodel\b[^.]*\bnot found\b/i,
  /^The model call failed/i,
  /\bLLM (?:call|request)\b/i
];

function isModelFailure(raw: string, run: Record<string, unknown>, failedNodeId: string): boolean {
  if (MODEL_ERROR_PATTERNS.some((pattern) => pattern.test(raw))) {
    return true;
  }
  // The chat model attached to the failed agent recorded the failed call.
  if (!failedNodeId || !Array.isArray(run.nodeResults)) {
    return false;
  }
  return run.nodeResults.some((entry) => {
    const output = asRecord(asRecord(entry)?.output);
    const details = asRecord(output?.details);
    return output?.handle === "chat_model" && output.usedByNodeId === failedNodeId && details?.stopReason === "error";
  });
}

/** The provider error an older server left as a chat model's answer in a run it called a success. */
function maskedModelErrorOf(run: Record<string, unknown>): string {
  if (!Array.isArray(run.nodeResults)) {
    return "";
  }
  for (const entry of run.nodeResults) {
    const output = asRecord(asRecord(entry)?.output);
    const details = asRecord(output?.details);
    if (output?.handle === "chat_model" && details?.stopReason === "error" && Number(details.iterations ?? 0) === 0) {
      return stringValue(details.answer) || "the provider returned an error";
    }
  }
  return "";
}

function failedNodeIdOf(run: Record<string, unknown>): string {
  if (!Array.isArray(run.nodeResults)) {
    return "";
  }
  for (const entry of run.nodeResults) {
    const record = asRecord(entry);
    if (record?.status === "error" && typeof record.nodeId === "string") {
      return record.nodeId;
    }
  }
  return "";
}

function isRunEnvelope(record: Record<string, unknown>): boolean {
  return Array.isArray(record.nodeResults) && typeof record.status === "string";
}

/** Nothing to show: no output, or only empty strings, nulls and empty containers. */
function isEmptyOutput(value: unknown, depth = 0): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim() === "";
  }
  if (depth > 4) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.every((item) => isEmptyOutput(item, depth + 1));
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every((item) => isEmptyOutput(item, depth + 1));
  }
  return false;
}

function providerBodyMessage(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const record = asRecord(parsed);
    const error = record?.error;
    const nested = asRecord(error);
    const message = stringValue(nested?.message) || stringValue(error) || stringValue(record?.message);
    if (message) {
      return message;
    }
  } catch {
    // Not JSON: the body is the message.
  }
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed;
}

function workflowLabelOf(run: Record<string, unknown>, context: RunFailureContext): string {
  return stringValue(run.workflowName) || stringValue(run.selectedWorkflowId) || stringValue(run.workflowId) || context.workflowLabel;
}

function quote(value: string): string {
  return `"${value}"`;
}

function stripTrailingPeriod(value: string): string {
  return value.replace(/[.\s]+$/, "");
}

function stringValue(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
