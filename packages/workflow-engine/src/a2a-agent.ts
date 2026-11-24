/**
 * The A2A Agent node: sends one message to a remote Agent2Agent agent and outputs its answer. As a Supervisor's
 * worker it runs through the same handler (executeNode), so the outbound URL guard, destination rules, activity,
 * labels and replay stubs apply to both uses.
 *
 * Every request (the card and the JSON-RPC endpoint) goes through `guardedFetch` with the deployment's outbound
 * policy: http(s) only, cloud metadata and link-local addresses always refused, private ranges refused under
 * OUTBOUND_DENY_PRIVATE unless allowlisted, the connection pinned to the vetted addresses, redirects re-checked and
 * credentials dropped when a redirect leaves the origin.
 */
import { ErrorCategory, WorkflowError } from "@ai-orchestrator/shared";
import { A2AClientError, callA2AAgent, createDefaultA2ARegistry, type A2ACallResult, type A2AFetch, type A2ARegistry } from "@ai-orchestrator/a2a-sdk";
import { DEFAULT_OUTBOUND_GUARD, guardedFetch, OutboundUrlBlockedError, type OutboundGuardConfig } from "./outbound-url-guard";
import { isNetworkFailure } from "./http-errors";

/** How long one remote task may take when the node sets no timeout. */
export const A2A_AGENT_DEFAULT_TIMEOUT_MS = 120_000;
/** The message an A2A Agent sends when its template is unset: the step's prompt (a supervisor's task, as a worker). */
export const A2A_AGENT_DEFAULT_MESSAGE_TEMPLATE = "{{user_prompt}}";

let sharedRegistry: A2ARegistry | null = null;
/** The default adapters, for a runtime that passes no registry of its own. */
export function defaultA2ARegistry(): A2ARegistry {
  sharedRegistry ??= createDefaultA2ARegistry();
  return sharedRegistry;
}

export interface A2aAgentSettings {
  cardUrl: string;
  messageTemplate: string;
  timeoutMs: number;
}

export function readA2aAgentSettings(config: Record<string, unknown>): A2aAgentSettings {
  const cardUrl = typeof config.cardUrl === "string" ? config.cardUrl.trim() : "";
  const messageTemplate = typeof config.messageTemplate === "string" && config.messageTemplate.trim() ? config.messageTemplate : A2A_AGENT_DEFAULT_MESSAGE_TEMPLATE;
  const timeoutMs =
    typeof config.timeoutMs === "number" && Number.isFinite(config.timeoutMs) && config.timeoutMs > 0 ? Math.floor(config.timeoutMs) : A2A_AGENT_DEFAULT_TIMEOUT_MS;
  return { cardUrl, messageTemplate, timeoutMs };
}

/** What the node outputs. `state` is `completed` or `input-required` (any other ending fails the node). */
export interface A2aAgentNodeOutput {
  text: string;
  state: string;
  taskId: string | null;
  contextId: string | null;
  artifacts: A2ACallResult["artifacts"];
  data: unknown;
  agent: { name: string; url: string; protocolVersion: string };
}

/** A fetch through the outbound URL guard (pinned connection, redirects re-checked). */
export function guardedA2AFetch(options: {
  outboundGuard?: OutboundGuardConfig;
  outboundDnsResolver?: (hostname: string) => Promise<string[]>;
  /** Phase 16 — each redirect hop judged again by the destination rules before it is followed. */
  onRedirect?: (url: string) => Promise<void>;
}): A2AFetch {
  return async (url, init) =>
    await guardedFetch(url, init, {
      config: options.outboundGuard ?? DEFAULT_OUTBOUND_GUARD,
      ...(options.outboundDnsResolver ? { resolver: options.outboundDnsResolver } : {}),
      ...(options.onRedirect ? { onRedirect: options.onRedirect } : {})
    });
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return "the agent";
  }
}

/** Endings that fail the node: the remote agent did not do the task. */
const FAILED_STATES = new Set(["failed", "rejected", "canceled", "auth-required", "unknown"]);

export async function runA2aAgentNode(input: {
  nodeName: string;
  settings: A2aAgentSettings;
  message: string;
  token?: string;
  registry: A2ARegistry;
  fetch: A2AFetch;
  signal?: AbortSignal;
  /** True when the run itself was stopped: the caller turns that into a cancel, not a node failure. */
  runAborted: () => boolean;
}): Promise<A2aAgentNodeOutput> {
  const { settings } = input;
  let result: A2ACallResult;
  try {
    result = await callA2AAgent(input.registry, {
      cardUrl: settings.cardUrl,
      text: input.message,
      context: { fetch: input.fetch, ...(input.token ? { token: input.token } : {}), ...(input.signal ? { signal: input.signal } : {}) },
      timeoutMs: settings.timeoutMs
    });
  } catch (error) {
    if (input.runAborted() || error instanceof OutboundUrlBlockedError) throw error;
    const where = hostOf(settings.cardUrl);
    if (error instanceof A2AClientError) {
      if (error.kind === "timeout") {
        throw new WorkflowError(
          `A2A Agent '${input.nodeName}': the agent at ${where} did not finish within ${settings.timeoutMs} ms.`,
          ErrorCategory.CONNECTOR_TRANSIENT,
          true,
          { timeoutMs: settings.timeoutMs },
          "Raise the node's Timeout, or check the remote agent; the task was canceled there."
        );
      }
      const auth = error.status === 401 || error.status === 403;
      throw new WorkflowError(
        `A2A Agent '${input.nodeName}': ${error.message}`,
        error.kind === "unsupported" || error.kind === "card" ? ErrorCategory.NODE_CONFIG : ErrorCategory.CONNECTOR_TRANSIENT,
        error.kind === "http" && !auth && (error.status ?? 0) >= 500,
        { ...(error.code !== undefined ? { code: error.code } : {}), ...(error.status !== undefined ? { status: error.status } : {}) },
        auth ? "The agent refused the token. Pick the secret that holds a token it accepts." : undefined
      );
    }
    if (isNetworkFailure(error)) {
      throw new WorkflowError(
        `A2A Agent '${input.nodeName}': the agent at ${where} could not be reached: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCategory.CONNECTOR_TRANSIENT,
        true,
        {},
        "Check the card URL and that the agent is up and reachable from the API host."
      );
    }
    throw error;
  }
  if (FAILED_STATES.has(result.state)) {
    const reason = result.text ? `: ${result.text.slice(0, 500)}` : ".";
    throw new WorkflowError(
      `A2A Agent '${input.nodeName}': the agent '${result.agent.name}' ended the task as ${result.state}${reason}`,
      ErrorCategory.CONNECTOR_TRANSIENT,
      false,
      { state: result.state, ...(result.taskId ? { taskId: result.taskId } : {}) },
      result.state === "auth-required" ? "The remote agent needs more credentials than this node sends." : undefined
    );
  }
  return {
    text: result.text,
    state: result.state,
    taskId: result.taskId ?? null,
    contextId: result.contextId ?? null,
    artifacts: result.artifacts,
    data: result.data ?? null,
    agent: result.agent
  };
}
