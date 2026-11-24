import { randomUUID } from "node:crypto";
import {
  A2A_LEGACY_METHODS,
  A2A_METHODS,
  A2A_PROTOCOL_VERSION,
  A2A_VERSION_HEADER,
  a2aAgentCardSchema,
  a2aCardUrlFor,
  readA2ASendResult,
  readA2ATask,
  resolveA2AEndpoint,
  toLegacyMessage,
  type A2AMessage,
  type A2ATask
} from "@ai-orchestrator/shared";
import { A2AClientError, type A2ACallContext, type A2AClientAdapter, type A2AResolvedAgent, type A2ASendResult } from "../types";

/** The most a card or a JSON-RPC answer may weigh. A bigger one is refused, not read. */
export const A2A_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/**
 * The body as text, read chunk by chunk and stopped (the stream canceled) as soon as it passes the cap, so an answer
 * without a Content-Length (chunked) is never held in memory past A2A_MAX_RESPONSE_BYTES.
 */
export async function readBody(response: Response, what: string, maxBytes: number = A2A_MAX_RESPONSE_BYTES): Promise<string> {
  const tooLarge = () => new A2AClientError("protocol", `The ${what} is larger than ${maxBytes} bytes.`);
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function headersFor(context: A2ACallContext, extra: Record<string, string> = {}): Headers {
  const headers = new Headers({ accept: "application/json", ...extra });
  if (context.token) headers.set("authorization", `Bearer ${context.token}`);
  return headers;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "the agent";
  }
}

/**
 * The A2A JSON-RPC binding over HTTP(S): reads the agent's card, then sends `SendMessage` / `GetTask` / `CancelTask`
 * (or their 0.3 names to an agent whose card only offers 0.3). Every request goes through the context's fetch.
 */
export class JsonRpcA2AAdapter implements A2AClientAdapter {
  readonly id = "jsonrpc";

  handles(cardUrl: string): boolean {
    return /^https?:\/\//i.test(cardUrl.trim());
  }

  async resolveAgent(cardUrl: string, context: A2ACallContext): Promise<A2AResolvedAgent> {
    const url = a2aCardUrlFor(cardUrl);
    const response = await context.fetch(url, { method: "GET", headers: headersFor(context), ...(context.signal ? { signal: context.signal } : {}) });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new A2AClientError("card", `The agent card at ${hostOf(url)} answered HTTP ${response.status}.`, { status: response.status });
    }
    let raw: unknown;
    try {
      raw = JSON.parse(await readBody(response, "agent card"));
    } catch (error) {
      if (error instanceof A2AClientError) throw error;
      throw new A2AClientError("card", `The agent card at ${hostOf(url)} is not JSON.`);
    }
    const parsed = a2aAgentCardSchema.safeParse(raw);
    if (!parsed.success) throw new A2AClientError("card", `The agent card at ${hostOf(url)} is not an A2A agent card (it has no name).`);
    const endpoint = resolveA2AEndpoint(parsed.data);
    if (!endpoint) {
      throw new A2AClientError("unsupported", `The agent at ${hostOf(url)} offers no JSON-RPC interface of A2A 1.0 or 0.3, which is what L2M speaks.`);
    }
    // A relative endpoint is read against the card's own URL.
    const resolvedUrl = new URL(endpoint.url, url).toString();
    if (!/^https?:\/\//i.test(resolvedUrl)) throw new A2AClientError("card", `The agent card at ${hostOf(url)} names an endpoint that is not http(s).`);
    // Messages (and the token) go only to the host the node names, the one its outbound checks judged: a card cannot
    // send them elsewhere.
    if (new URL(resolvedUrl).origin !== new URL(url).origin) {
      throw new A2AClientError(
        "card",
        `The agent card at ${hostOf(url)} names an endpoint on another host (${hostOf(resolvedUrl)}). L2M calls only the host in the Agent URL: use the card URL on the endpoint's own host.`
      );
    }
    return { cardUrl: url, card: parsed.data, endpoint: { ...endpoint, url: resolvedUrl } };
  }

  private async call(agent: A2AResolvedAgent, method: string, params: unknown, context: A2ACallContext): Promise<unknown> {
    const legacy = agent.endpoint.version !== A2A_PROTOCOL_VERSION;
    const response = await context.fetch(agent.endpoint.url, {
      method: "POST",
      headers: headersFor(context, { "content-type": "application/json", [A2A_VERSION_HEADER]: agent.endpoint.version }),
      body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params }),
      ...(context.signal ? { signal: context.signal } : {})
    });
    const text = await readBody(response, "agent's answer");
    let body: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(text) as unknown;
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      body = null;
    }
    const error = body?.error && typeof body.error === "object" ? (body.error as Record<string, unknown>) : null;
    if (error) {
      const code = typeof error.code === "number" ? error.code : undefined;
      const message = typeof error.message === "string" && error.message.trim() ? error.message.trim().slice(0, 500) : "no message";
      throw new A2AClientError("remote", `The agent answered ${method} with error${code !== undefined ? ` ${code}` : ""}: ${message}`, {
        ...(code !== undefined ? { code } : {}),
        status: response.status
      });
    }
    if (!response.ok) throw new A2AClientError("http", `The agent answered ${method} with HTTP ${response.status}.`, { status: response.status });
    if (!body || !("result" in body)) {
      throw new A2AClientError("protocol", `The agent's answer to ${method} is not a JSON-RPC response${legacy ? " (A2A 0.3)" : ""}.`);
    }
    return body.result;
  }

  async sendMessage(agent: A2AResolvedAgent, message: A2AMessage, context: A2ACallContext): Promise<A2ASendResult> {
    const legacy = agent.endpoint.version !== A2A_PROTOCOL_VERSION;
    const result = legacy
      ? await this.call(agent, A2A_LEGACY_METHODS.send, { message: toLegacyMessage(message), configuration: { blocking: true } }, context)
      : await this.call(agent, A2A_METHODS.send, { message, configuration: { returnImmediately: false } }, context);
    const read = readA2ASendResult(result);
    if (!read) throw new A2AClientError("protocol", "The agent's answer to the message is neither a task nor a message.");
    return read;
  }

  async getTask(agent: A2AResolvedAgent, taskId: string, context: A2ACallContext): Promise<A2ATask> {
    const legacy = agent.endpoint.version !== A2A_PROTOCOL_VERSION;
    const result = await this.call(agent, legacy ? A2A_LEGACY_METHODS.get : A2A_METHODS.get, { id: taskId }, context);
    const task = readA2ATask(result);
    if (!task) throw new A2AClientError("protocol", "The agent's answer to GetTask is not a task.");
    return task;
  }

  async cancelTask(agent: A2AResolvedAgent, taskId: string, context: A2ACallContext): Promise<A2ATask | null> {
    const legacy = agent.endpoint.version !== A2A_PROTOCOL_VERSION;
    const result = await this.call(agent, legacy ? A2A_LEGACY_METHODS.cancel : A2A_METHODS.cancel, { id: taskId }, context);
    return readA2ATask(result);
  }
}
