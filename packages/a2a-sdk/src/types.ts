import type { A2AAgentCardInput, A2AEndpoint, A2AMessage, A2ATask } from "@ai-orchestrator/shared";

/**
 * How an adapter reaches the network. The runtime passes its own fetch (the workflow engine's passes the outbound URL
 * guard's pinned fetch), so this package never opens a connection by itself.
 */
export type A2AFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface A2ACallContext {
  fetch: A2AFetch;
  /** Sent as `Authorization: Bearer <token>` on every request to the agent (the card included). */
  token?: string;
  /** Stops the call (the run was canceled, or its time ran out). */
  signal?: AbortSignal;
}

/** A remote agent, as its card describes it and as it will be called. */
export interface A2AResolvedAgent {
  cardUrl: string;
  card: A2AAgentCardInput;
  endpoint: A2AEndpoint;
}

export type A2ASendResult = { task: A2ATask } | { message: A2AMessage };

/**
 * One way of talking to remote agents. `jsonrpc` speaks the A2A JSON-RPC binding over HTTP; others (a mock for tests
 * and samples) can be registered beside it. The registry picks an adapter by the card URL.
 */
export interface A2AClientAdapter {
  readonly id: string;
  /** Whether this adapter calls agents at this card URL. */
  handles(cardUrl: string): boolean;
  resolveAgent(cardUrl: string, context: A2ACallContext): Promise<A2AResolvedAgent>;
  sendMessage(agent: A2AResolvedAgent, message: A2AMessage, context: A2ACallContext): Promise<A2ASendResult>;
  getTask(agent: A2AResolvedAgent, taskId: string, context: A2ACallContext): Promise<A2ATask>;
  cancelTask(agent: A2AResolvedAgent, taskId: string, context: A2ACallContext): Promise<A2ATask | null>;
}

export type A2AErrorKind = "card" | "http" | "protocol" | "remote" | "timeout" | "unsupported";

/** A failed call to a remote agent. `code` is the JSON-RPC error code the agent answered with, when it did. */
export class A2AClientError extends Error {
  readonly kind: A2AErrorKind;
  readonly code?: number;
  readonly status?: number;
  constructor(kind: A2AErrorKind, message: string, details: { code?: number; status?: number } = {}) {
    super(message);
    this.name = "A2AClientError";
    this.kind = kind;
    if (details.code !== undefined) this.code = details.code;
    if (details.status !== undefined) this.status = details.status;
  }
}
