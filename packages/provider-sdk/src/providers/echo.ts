import type { ChatMessage, ProviderDefinition, ToolCall, ToolDefinition } from "@ai-orchestrator/shared";
import type { LLMProviderAdapter, ProviderCallRequest, ProviderExecutionContext, ProviderTestResult } from "../types";

/** The id of the demo tool call Echo makes (one per run). */
export const ECHO_DEMO_TOOL_CALL_ID = "echo-demo-call-1";

/** What Echo says about itself whenever an agent gave it tools. */
const ECHO_TEST_MODEL_NOTE =
  "Echo is a test model: it repeats your message and cannot choose tools or read their results. " +
  "Pick a real model on the agent's Chat Model node to have the agent decide which tools to call.";

const RESULT_PREVIEW_CHARS = 600;

const approxTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));

function plain(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * The arguments Echo's demo call sends, or null when Echo cannot fill the tool's required inputs without inventing
 * values. Optional inputs are left out. A required input with a default gets that default. One required text input
 * (a string with no fixed choices or format) gets the user's own message. Anything else required, or more than one
 * required text input, means no call.
 */
export function echoDemoArguments(inputSchema: Record<string, unknown>, userText: string): Record<string, unknown> | null {
  const properties = plain(inputSchema.properties);
  const required = Array.isArray(inputSchema.required) ? inputSchema.required.filter((name): name is string => typeof name === "string") : [];
  const args: Record<string, unknown> = {};
  let textSlot: string | undefined;
  for (const name of required) {
    const property = plain(properties[name]);
    if ("default" in property) {
      args[name] = property.default;
      continue;
    }
    const freeText =
      property.type === "string" &&
      property.enum === undefined &&
      property.const === undefined &&
      property.format === undefined &&
      property.pattern === undefined &&
      (typeof property.maxLength !== "number" || property.maxLength >= userText.length) &&
      (typeof property.minLength !== "number" || property.minLength <= userText.length);
    if (!freeText || textSlot !== undefined) return null;
    textSlot = name;
  }
  if (textSlot !== undefined) {
    if (!userText.trim()) return null;
    args[textSlot] = userText;
  }
  return args;
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3));
}

/** How well a tool's name and description match the message: the words they share. */
function matchScore(tool: ToolDefinition, messageWords: Set<string>): number {
  let score = 0;
  for (const word of words(`${tool.name.replace(/_/g, " ")} ${tool.description ?? ""}`)) {
    if (messageWords.has(word)) score += 1;
  }
  return score;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * A tool result made readable: the `output` of an `{ ok, output }` envelope, JSON text inside it parsed, and the
 * whole shown as indented JSON (plain text stays as it is), cut to a preview.
 */
function previewOf(text: string): string {
  let value: unknown = parseJson(text.trim());
  if (value === undefined) {
    const trimmed = text.trim();
    return trimmed.length > RESULT_PREVIEW_CHARS ? `${trimmed.slice(0, RESULT_PREVIEW_CHARS)}…` : trimmed;
  }
  const envelope = plain(value);
  if ("output" in envelope && Object.keys(envelope).every((key) => key === "ok" || key === "output")) value = envelope.output;
  const unwrap = (entry: unknown): unknown => {
    if (typeof entry === "string" && /^\s*[[{]/.test(entry)) return parseJson(entry) ?? entry;
    if (Array.isArray(entry)) return entry;
    if (entry && typeof entry === "object") return Object.fromEntries(Object.entries(entry as Record<string, unknown>).map(([key, inner]) => [key, unwrap(inner)]));
    return entry;
  };
  value = unwrap(value);
  const shown = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return shown.length > RESULT_PREVIEW_CHARS ? `${shown.slice(0, RESULT_PREVIEW_CHARS)}…` : shown;
}

/**
 * In-process zero-dependency LLM provider that echoes back the last user
 * message. Lets the seed `Basic LLM Flow` and any "smoke test" workflow run
 * end-to-end on a fresh install with no Ollama, no OpenAI key, no Pinecone —
 * just `pnpm dev` and click Run.
 *
 * Behaviour:
 * - Returns the last user message content prefixed with `prefix` (default
 *   "Echo: "), or a friendly hint when no user message is present.
 * - With tools (an agent), Echo makes one labelled demo tool call per user
 *   message so the agent loop can be seen without a key, then answers that it
 *   is a test model. Safety: the call goes only to a tool named in
 *   `options.demoReadOnlyTools`, which the agent loop fills with the tools L2M
 *   itself classifies read-only (admin-marked read-only, built-in tools,
 *   read-only workflow tools); a server's own read-only hint is not enough.
 *   Echo never invents a value for a required input (see
 *   `echoDemoArguments`). With no tool that qualifies it calls none and says
 *   why.
 * - testConnection always succeeds (it's in-process).
 *
 * NOT meant for production agentic work; swap in a real provider when ready.
 */
export class EchoProviderAdapter implements LLMProviderAdapter {
  readonly definition: ProviderDefinition = {
    id: "echo",
    label: "Echo (built-in demo)",
    supportsTools: true,
    configSchema: {
      type: "object",
      properties: {
        prefix: {
          type: "string",
          default: "Echo: ",
          description:
            "Prepended to the echoed user message. Default 'Echo: ' makes it obvious this is the demo provider, not a real LLM."
        }
      }
    }
  };

  async generate(request: ProviderCallRequest, _context: ProviderExecutionContext) {
    const provider = request.provider as unknown as Record<string, unknown>;
    const prefix = typeof provider.prefix === "string" ? provider.prefix : "Echo: ";

    const lastUserIndex = request.messages.map((message) => message.role).lastIndexOf("user");
    const lastUser = lastUserIndex >= 0 ? request.messages[lastUserIndex] : undefined;
    const userText = typeof lastUser?.content === "string" ? lastUser.content : "";

    if (!userText.trim()) {
      return this.answer(
        "Echo provider received no user message. Wire a Text Input or Prompt Template into this LLM Call to see the echo.",
        ""
      );
    }

    const tools = request.tools ?? [];
    if (tools.length === 0) {
      return this.answer(`${prefix}${userText}`, userText);
    }

    // An agent: after the demo call, answer with what the tool returned.
    const sinceUser = request.messages.slice(lastUserIndex + 1);
    const demoResult = sinceUser.find((message) => message.role === "tool");
    if (demoResult) {
      return this.answer(`${prefix}${userText}\n\n${this.demoCallSummary(sinceUser, demoResult)}\n\n${ECHO_TEST_MODEL_NOTE}`, userText);
    }

    const readOnly = new Set(request.options?.demoReadOnlyTools ?? []);
    const safeTools = tools.filter((tool) => readOnly.has(tool.name));
    const messageWords = words(userText);
    const candidates = safeTools
      .map((tool, index) => ({ tool, index, args: echoDemoArguments(plain(tool.inputSchema), userText), score: matchScore(tool, messageWords) }))
      .filter((entry): entry is { tool: ToolDefinition; index: number; args: Record<string, unknown>; score: number } => entry.args !== null)
      .sort((a, b) => b.score - a.score || a.index - b.index);

    const chosen = candidates[0];
    if (!chosen) {
      const reason =
        safeTools.length === 0
          ? `none of the attached tools is read-only in L2M (an admin can mark a tool read-only on its MCP server's page; built-in tools and read-only workflow tools count too), and Echo only calls read-only tools`
          : "the read-only tools need inputs Echo cannot fill in from your message, and Echo never makes inputs up";
      return this.answer(`${prefix}${userText}\n\nEcho made no demo tool call: ${reason}.\n\n${ECHO_TEST_MODEL_NOTE}`, userText);
    }

    const call: ToolCall = { id: ECHO_DEMO_TOOL_CALL_ID, name: chosen.tool.name, arguments: chosen.args };
    return {
      ...this.answer(`Echo test model: demo call to ${chosen.tool.name}, made once so you can see the agent loop. A real model chooses its own tools.`, userText),
      toolCalls: [call]
    };
  }

  private demoCallSummary(sinceUser: ChatMessage[], result: ChatMessage): string {
    const requested = sinceUser.find((message) => message.role === "assistant" && message.toolCalls?.length)?.toolCalls?.[0];
    const name = requested?.name ?? result.name ?? "a tool";
    const output = previewOf(typeof result.content === "string" ? result.content : "");
    return `Demo tool call: Echo called ${name} once so you can see the agent loop. It returned:\n${output || "(nothing)"}`;
  }

  private answer(content: string, userText: string) {
    const inputTokens = userText ? approxTokens(userText) : 0;
    return {
      content,
      toolCalls: [] as ToolCall[],
      // Echo has no real token counts; a coarse estimate keeps the canvas usage pill meaningful.
      usage: { inputTokens, outputTokens: approxTokens(content), totalTokens: inputTokens + approxTokens(content) },
      latencyMs: 0
    };
  }

  async testConnection(): Promise<ProviderTestResult> {
    return { ok: true, message: "Echo provider is built in — no connection required.", latencyMs: 0 };
  }
}
