import { randomUUID } from "node:crypto";
import {
  a2aPartsText,
  isInterruptedTaskState,
  isTerminalTaskState,
  legacyTaskState,
  type A2AArtifact,
  type A2AMessage,
  type A2APart,
  type A2ATask,
  type A2ATaskState
} from "@ai-orchestrator/shared";
import type { A2ARegistry } from "./registry";
import { A2AClientError, type A2ACallContext, type A2AResolvedAgent } from "./types";

/** How often a task that is still working is asked for again, at first (it doubles up to the cap). */
export const A2A_POLL_INITIAL_MS = 500;
export const A2A_POLL_MAX_MS = 5_000;

export interface A2ACallInput {
  cardUrl: string;
  text: string;
  /** Sent as a data part beside the text, when set. */
  data?: unknown;
  contextId?: string;
  context: A2ACallContext;
  /** Longest the whole call may take: the task is canceled (best effort) and the call fails after it. */
  timeoutMs: number;
  pollInitialMs?: number;
  pollMaxMs?: number;
}

export interface A2ACallResult {
  agent: { name: string; url: string; protocolVersion: string };
  /** The final state, as 0.3 spells it (`completed`, `input-required`): what workflows read and branch on. */
  state: string;
  taskState: A2ATaskState;
  text: string;
  /** The data parts of the answer: one value when there is one, an array for several, undefined for none. */
  data?: unknown;
  taskId?: string;
  contextId?: string;
  artifacts: A2AArtifact[];
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function dataOf(parts: readonly A2APart[]): unknown {
  const data = parts.filter((part) => part.data !== undefined).map((part) => part.data);
  return data.length === 0 ? undefined : data.length === 1 ? data[0] : data;
}

function resultOf(agent: A2AResolvedAgent, task: A2ATask | null, message: A2AMessage | null): A2ACallResult {
  const base = {
    agent: { name: agent.card.name, url: agent.endpoint.url, protocolVersion: agent.endpoint.version }
  };
  if (!task) {
    const parts = message?.parts ?? [];
    const data = dataOf(parts);
    return {
      ...base,
      state: legacyTaskState("TASK_STATE_COMPLETED"),
      taskState: "TASK_STATE_COMPLETED",
      text: a2aPartsText(parts),
      ...(data !== undefined ? { data } : {}),
      ...(message?.contextId ? { contextId: message.contextId } : {}),
      artifacts: []
    };
  }
  const artifacts = task.artifacts ?? [];
  const artifactParts = artifacts.flatMap((artifact) => artifact.parts);
  const statusText = a2aPartsText(task.status.message?.parts);
  // A finished task answers with its artifacts; a task that stopped to ask answers with its question.
  const text = isInterruptedTaskState(task.status.state) ? statusText || a2aPartsText(artifactParts) : a2aPartsText(artifactParts) || statusText;
  const data = dataOf(artifactParts);
  return {
    ...base,
    state: legacyTaskState(task.status.state),
    taskState: task.status.state,
    text,
    ...(data !== undefined ? { data } : {}),
    taskId: task.id,
    ...(task.contextId ? { contextId: task.contextId } : {}),
    artifacts
  };
}

/**
 * Sends one message to a remote agent and waits for the outcome: a reply message, or a task that reached a terminal
 * state or stopped to ask (input-required, auth-required). A task that is still working is asked for again (GetTask)
 * until then. Past `timeoutMs` the task is canceled (best effort) and the call fails.
 */
export async function callA2AAgent(registry: A2ARegistry, input: A2ACallInput): Promise<A2ACallResult> {
  const adapter = registry.resolve(input.cardUrl);
  if (!adapter) throw new A2AClientError("unsupported", "The agent URL must start with http:// or https://.");
  const deadline = Date.now() + input.timeoutMs;
  const timeout = AbortSignal.timeout(Math.max(1, input.timeoutMs));
  const signal = input.context.signal ? AbortSignal.any([input.context.signal, timeout]) : timeout;
  const context: A2ACallContext = { ...input.context, signal };
  const timedOut = () => timeout.aborted && !input.context.signal?.aborted;
  let agent: A2AResolvedAgent | null = null;
  let task: A2ATask | null = null;
  try {
    agent = await adapter.resolveAgent(input.cardUrl, context);
    const parts: A2APart[] = [{ text: input.text }];
    if (input.data !== undefined) parts.push({ data: input.data, mediaType: "application/json" });
    const message: A2AMessage = { messageId: randomUUID(), role: "ROLE_USER", parts, ...(input.contextId ? { contextId: input.contextId } : {}) };
    const sent = await adapter.sendMessage(agent, message, context);
    if ("message" in sent) return resultOf(agent, null, sent.message);
    task = sent.task;
    let wait = input.pollInitialMs ?? A2A_POLL_INITIAL_MS;
    const maxWait = input.pollMaxMs ?? A2A_POLL_MAX_MS;
    while (!isTerminalTaskState(task.status.state) && !isInterruptedTaskState(task.status.state)) {
      await sleep(Math.min(wait, Math.max(0, deadline - Date.now())), signal);
      wait = Math.min(maxWait, wait * 2);
      task = await adapter.getTask(agent, task.id, context);
    }
    return resultOf(agent, task, null);
  } catch (error) {
    if (timedOut()) {
      if (agent && task && !isTerminalTaskState(task.status.state)) {
        const stopping = agent;
        const taskId = task.id;
        // Best effort, with its own short limit: the call has already failed.
        await adapter.cancelTask(stopping, taskId, { ...input.context, signal: AbortSignal.timeout(5_000) }).catch(() => undefined);
      }
      throw new A2AClientError("timeout", `The remote agent did not finish within ${input.timeoutMs} ms.`);
    }
    throw error;
  }
}
