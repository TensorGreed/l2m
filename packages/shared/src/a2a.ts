import { z } from "zod";

/**
 * Agent2Agent (A2A) protocol: the wire contract L2M serves (the Expose as A2A Agent trigger) and calls (the A2A Agent
 * node). Implements A2A 1.0 over the JSON-RPC 2.0 binding (a2a-protocol.org, specification/a2a.proto): PascalCase
 * methods, ProtoJSON enum names (`TASK_STATE_COMPLETED`, `ROLE_USER`), parts without a `kind` discriminator and stream
 * events wrapped as exactly one of `task`, `message`, `statusUpdate` or `artifactUpdate`.
 *
 * 0.3 peers are still common, and the spec lets a server accept both forms while they overlap, so this module also
 * converts to and from the 0.3 shapes (`message/send`, `kind`, lowercase states, `final` on status updates).
 */

/** The A2A version L2M implements (Major.Minor, as the `A2A-Version` header and an interface's protocolVersion carry it). */
export const A2A_PROTOCOL_VERSION = "1.0";
/** The older version L2M still answers and can call. */
export const A2A_LEGACY_PROTOCOL_VERSION = "0.3";
/** The header a client names its A2A version in. Absent means 0.3 (spec). */
export const A2A_VERSION_HEADER = "A2A-Version";
/** The binding L2M serves and calls. */
export const A2A_JSONRPC_BINDING = "JSONRPC";
/** Where an agent's card lives under its base URL. */
export const A2A_AGENT_CARD_PATH = ".well-known/agent-card.json";

/** 1.0 method names. */
export const A2A_METHODS = {
  send: "SendMessage",
  stream: "SendStreamingMessage",
  get: "GetTask",
  cancel: "CancelTask"
} as const;

/** 0.3 method names, answered with 0.3 shapes. */
export const A2A_LEGACY_METHODS = {
  send: "message/send",
  stream: "message/stream",
  get: "tasks/get",
  cancel: "tasks/cancel"
} as const;

export type A2AMethodKind = keyof typeof A2A_METHODS;

/** Push notification methods (1.0 and 0.3): L2M declares push notifications unsupported. */
export const A2A_PUSH_METHODS: ReadonlySet<string> = new Set([
  "CreateTaskPushNotificationConfig",
  "GetTaskPushNotificationConfig",
  "ListTaskPushNotificationConfigs",
  "DeleteTaskPushNotificationConfig",
  "tasks/pushNotificationConfig/set",
  "tasks/pushNotificationConfig/get",
  "tasks/pushNotificationConfig/list",
  "tasks/pushNotificationConfig/delete"
]);

/** Which method a JSON-RPC `method` names, and whether it is the 0.3 spelling; null for anything else. */
export function a2aMethodOf(method: string): { kind: A2AMethodKind; legacy: boolean } | null {
  for (const kind of Object.keys(A2A_METHODS) as A2AMethodKind[]) {
    if (A2A_METHODS[kind] === method) return { kind, legacy: false };
    if (A2A_LEGACY_METHODS[kind] === method) return { kind, legacy: true };
  }
  return null;
}

/** JSON-RPC and A2A error codes. */
export const A2A_ERROR_CODES = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  taskNotFound: -32001,
  taskNotCancelable: -32002,
  pushNotificationNotSupported: -32003,
  unsupportedOperation: -32004,
  contentTypeNotSupported: -32005,
  invalidAgentResponse: -32006,
  versionNotSupported: -32009
} as const;

export const A2A_TASK_STATES = [
  "TASK_STATE_SUBMITTED",
  "TASK_STATE_WORKING",
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_INPUT_REQUIRED",
  "TASK_STATE_REJECTED",
  "TASK_STATE_AUTH_REQUIRED"
] as const;
export type A2ATaskState = (typeof A2A_TASK_STATES)[number] | "TASK_STATE_UNSPECIFIED";

const TERMINAL_STATES: ReadonlySet<A2ATaskState> = new Set<A2ATaskState>([
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_REJECTED"
]);

/** A task in one of these states never changes again. */
export function isTerminalTaskState(state: A2ATaskState): boolean {
  return TERMINAL_STATES.has(state);
}

/** States in which the task waits on someone outside the agent: the caller stops waiting there. */
export function isInterruptedTaskState(state: A2ATaskState): boolean {
  return state === "TASK_STATE_INPUT_REQUIRED" || state === "TASK_STATE_AUTH_REQUIRED";
}

const LEGACY_STATE: Readonly<Record<A2ATaskState, string>> = {
  TASK_STATE_UNSPECIFIED: "unknown",
  TASK_STATE_SUBMITTED: "submitted",
  TASK_STATE_WORKING: "working",
  TASK_STATE_COMPLETED: "completed",
  TASK_STATE_FAILED: "failed",
  TASK_STATE_CANCELED: "canceled",
  TASK_STATE_INPUT_REQUIRED: "input-required",
  TASK_STATE_REJECTED: "rejected",
  TASK_STATE_AUTH_REQUIRED: "auth-required"
};

/** A task state as either version writes it (`TASK_STATE_COMPLETED` or `completed`), read as 1.0. */
export function readTaskState(value: unknown): A2ATaskState {
  if (typeof value !== "string") return "TASK_STATE_UNSPECIFIED";
  if ((A2A_TASK_STATES as readonly string[]).includes(value)) return value as A2ATaskState;
  const found = (Object.entries(LEGACY_STATE) as Array<[A2ATaskState, string]>).find(([, legacy]) => legacy === value);
  return found ? found[0] : "TASK_STATE_UNSPECIFIED";
}

export function legacyTaskState(state: A2ATaskState): string {
  return LEGACY_STATE[state];
}

// ---------------------------------------------------------------------------
// Objects (1.0)
// ---------------------------------------------------------------------------

/** A part: exactly one of text, raw (base64), url or data, plus optional metadata, filename and media type. */
export const a2aPartSchema = z
  .object({
    text: z.string().optional(),
    raw: z.string().optional(),
    url: z.string().optional(),
    data: z.unknown().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    filename: z.string().optional(),
    mediaType: z.string().optional()
  })
  .passthrough();
export type A2APart = z.infer<typeof a2aPartSchema>;

export const a2aMessageSchema = z
  .object({
    messageId: z.string().min(1),
    contextId: z.string().optional(),
    taskId: z.string().optional(),
    role: z.string(),
    parts: z.array(a2aPartSchema),
    metadata: z.record(z.string(), z.unknown()).optional(),
    extensions: z.array(z.string()).optional(),
    referenceTaskIds: z.array(z.string()).optional()
  })
  .passthrough();
export type A2AMessage = z.infer<typeof a2aMessageSchema>;

export interface A2ATaskStatus {
  state: A2ATaskState;
  message?: A2AMessage;
  timestamp?: string;
}

export interface A2AArtifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: A2APart[];
  metadata?: Record<string, unknown>;
}

export interface A2ATask {
  id: string;
  contextId?: string;
  status: A2ATaskStatus;
  artifacts?: A2AArtifact[];
  history?: A2AMessage[];
  metadata?: Record<string, unknown>;
}

export interface A2ATaskStatusUpdateEvent {
  taskId: string;
  contextId: string;
  status: A2ATaskStatus;
  metadata?: Record<string, unknown>;
}

export interface A2ATaskArtifactUpdateEvent {
  taskId: string;
  contextId: string;
  artifact: A2AArtifact;
  append?: boolean;
  lastChunk?: boolean;
  metadata?: Record<string, unknown>;
}

/** One stream event (and a SendMessage response): exactly one member is set. */
export type A2AStreamResponse =
  | { task: A2ATask }
  | { message: A2AMessage }
  | { statusUpdate: A2ATaskStatusUpdateEvent }
  | { artifactUpdate: A2ATaskArtifactUpdateEvent };

export const a2aSendMessageParamsSchema = z
  .object({
    tenant: z.string().optional(),
    message: a2aMessageSchema,
    configuration: z
      .object({
        acceptedOutputModes: z.array(z.string()).optional(),
        historyLength: z.number().int().nonnegative().optional(),
        returnImmediately: z.boolean().optional(),
        /** 0.3: `blocking: false` is 1.0's `returnImmediately: true`. */
        blocking: z.boolean().optional()
      })
      .passthrough()
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .passthrough();
export type A2ASendMessageParams = z.infer<typeof a2aSendMessageParamsSchema>;

export const a2aTaskIdParamsSchema = z
  .object({
    tenant: z.string().optional(),
    id: z.string().min(1),
    historyLength: z.number().int().nonnegative().optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .passthrough();

export const a2aJsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string().min(1),
  params: z.unknown().optional()
});
export type A2AJsonRpcRequest = z.infer<typeof a2aJsonRpcRequestSchema>;

export interface A2AJsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export function a2aJsonRpcError(id: string | number | null | undefined, code: number, message: string, data?: unknown): {
  jsonrpc: "2.0";
  id: string | number | null;
  error: A2AJsonRpcError;
} {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

export function a2aJsonRpcResult(id: string | number | null | undefined, result: unknown): { jsonrpc: "2.0"; id: string | number | null; result: unknown } {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

// ---------------------------------------------------------------------------
// Agent Card
// ---------------------------------------------------------------------------

export interface A2AAgentInterface {
  url: string;
  protocolBinding: string;
  protocolVersion: string;
  tenant?: string;
}

export interface A2AAgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

export interface A2AAgentCard {
  name: string;
  description: string;
  supportedInterfaces: A2AAgentInterface[];
  version: string;
  capabilities: { streaming?: boolean; pushNotifications?: boolean; extendedAgentCard?: boolean };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2AAgentSkill[];
  provider?: { organization: string; url: string };
  documentationUrl?: string;
  securitySchemes?: Record<string, unknown>;
  securityRequirements?: Array<{ schemes: Record<string, { list: string[] }> }>;
  /** 0.3 compatibility: the primary endpoint, its version and binding. */
  url?: string;
  protocolVersion?: string;
  preferredTransport?: string;
}

/** A card as read from a peer: lenient, so cards of either version (and with fields L2M does not use) are accepted. */
export const a2aAgentCardSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional().default(""),
    version: z.string().optional(),
    url: z.string().optional(),
    protocolVersion: z.string().optional(),
    preferredTransport: z.string().optional(),
    supportedInterfaces: z
      .array(z.object({ url: z.string(), protocolBinding: z.string().optional(), protocolVersion: z.string().optional() }).passthrough())
      .optional(),
    additionalInterfaces: z.array(z.object({ url: z.string(), transport: z.string().optional() }).passthrough()).optional(),
    capabilities: z.object({ streaming: z.boolean().optional(), pushNotifications: z.boolean().optional() }).passthrough().optional(),
    skills: z
      .array(z.object({ id: z.string().optional(), name: z.string().optional(), description: z.string().optional() }).passthrough())
      .optional()
      .default([]),
    securitySchemes: z.record(z.string(), z.unknown()).optional()
  })
  .passthrough();
export type A2AAgentCardInput = z.infer<typeof a2aAgentCardSchema>;

/** The endpoint a client calls: the first JSON-RPC interface of a version L2M speaks, 1.0 preferred. */
export interface A2AEndpoint {
  url: string;
  /** "1.0" or "0.3": which method names and shapes the endpoint takes. */
  version: typeof A2A_PROTOCOL_VERSION | typeof A2A_LEGACY_PROTOCOL_VERSION;
}

function majorMinor(value: string | undefined): string {
  const match = /^(\d+)\.(\d+)/.exec(value ?? "");
  return match ? `${match[1]}.${match[2]}` : "";
}

/** Picks the endpoint to call from a card; null when it offers no JSON-RPC interface of a version L2M speaks. */
export function resolveA2AEndpoint(card: A2AAgentCardInput): A2AEndpoint | null {
  const jsonRpc = (card.supportedInterfaces ?? []).filter((entry) => (entry.protocolBinding ?? A2A_JSONRPC_BINDING).toUpperCase() === A2A_JSONRPC_BINDING);
  const current = jsonRpc.find((entry) => majorMinor(entry.protocolVersion).startsWith("1."));
  if (current) return { url: current.url, version: A2A_PROTOCOL_VERSION };
  const legacy = jsonRpc.find((entry) => majorMinor(entry.protocolVersion) === A2A_LEGACY_PROTOCOL_VERSION);
  if (legacy) return { url: legacy.url, version: A2A_LEGACY_PROTOCOL_VERSION };
  // A 0.3 card: the top-level url is the endpoint of the preferred transport (JSON-RPC when unnamed).
  if (card.url && (card.preferredTransport ?? A2A_JSONRPC_BINDING).toUpperCase() === A2A_JSONRPC_BINDING) {
    const version = majorMinor(card.protocolVersion);
    return { url: card.url, version: version.startsWith("1.") ? A2A_PROTOCOL_VERSION : A2A_LEGACY_PROTOCOL_VERSION };
  }
  const other = (card.additionalInterfaces ?? []).find((entry) => (entry.transport ?? "").toUpperCase() === A2A_JSONRPC_BINDING);
  return other ? { url: other.url, version: A2A_LEGACY_PROTOCOL_VERSION } : null;
}

/** The card URL for what a person typed: a card URL as it is, a base URL with the well-known card path added. */
export function a2aCardUrlFor(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  try {
    const url = new URL(trimmed);
    if (/\.json$/i.test(url.pathname)) return url.toString();
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/${A2A_AGENT_CARD_PATH}`;
    return url.toString();
  } catch {
    return trimmed;
  }
}

/** How an L2M agent takes calls: the trigger's Auth Mode. */
export type A2ATriggerAuthMode = "api_key" | "bearer" | "public";

/** The Auth Mode an A2A trigger runs with. Unset is an API key (it fails closed; this trigger never had an open default). */
export function a2aTriggerAuthMode(config: Record<string, unknown>): A2ATriggerAuthMode {
  const mode = config.authMode;
  return mode === "bearer" || mode === "public" ? mode : "api_key";
}

/** The card of an L2M agent: both 1.0 and 0.3 interfaces on the same endpoint. */
export function buildA2AAgentCard(input: {
  name: string;
  description: string;
  endpointUrl: string;
  skillId: string;
  authMode: A2ATriggerAuthMode;
  version?: string;
  documentationUrl?: string;
}): A2AAgentCard {
  const secured = input.authMode !== "public";
  const schemeDescription =
    input.authMode === "api_key" ? "An L2M API key of a user who may run this workflow, as a bearer token." : "The bearer token set on this agent's trigger.";
  return {
    name: input.name,
    description: input.description,
    supportedInterfaces: [
      { url: input.endpointUrl, protocolBinding: A2A_JSONRPC_BINDING, protocolVersion: A2A_PROTOCOL_VERSION },
      { url: input.endpointUrl, protocolBinding: A2A_JSONRPC_BINDING, protocolVersion: A2A_LEGACY_PROTOCOL_VERSION }
    ],
    version: input.version ?? "1",
    capabilities: { streaming: true, pushNotifications: false, extendedAgentCard: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [{ id: input.skillId, name: input.name, description: input.description || input.name, tags: ["workflow"] }],
    ...(input.documentationUrl ? { documentationUrl: input.documentationUrl } : {}),
    ...(secured
      ? {
          securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: "Bearer", description: schemeDescription } } },
          securityRequirements: [{ schemes: { bearer: { list: [] } } }]
        }
      : {}),
    url: input.endpointUrl,
    protocolVersion: "0.3.0",
    preferredTransport: A2A_JSONRPC_BINDING
  };
}

// ---------------------------------------------------------------------------
// Content helpers
// ---------------------------------------------------------------------------

/** The text of a message or artifact: its text parts joined by blank lines. */
export function a2aPartsText(parts: readonly A2APart[] | undefined): string {
  return (parts ?? [])
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter((text) => text.length > 0)
    .join("\n\n");
}

/** What a run receives from a message: its text, its data parts (one object when there is one) and its file references. */
export function a2aMessageInput(message: A2AMessage): { text: string; data: unknown; files: Array<{ url?: string; filename?: string; mediaType?: string; inline?: boolean }> } {
  const dataParts = message.parts.filter((part) => part.data !== undefined).map((part) => part.data);
  const files = message.parts
    .filter((part) => typeof part.url === "string" || typeof part.raw === "string")
    .map((part) => ({
      ...(typeof part.url === "string" ? { url: part.url } : { inline: true }),
      ...(part.filename ? { filename: part.filename } : {}),
      ...(part.mediaType ? { mediaType: part.mediaType } : {})
    }));
  return { text: a2aPartsText(message.parts), data: dataParts.length === 0 ? undefined : dataParts.length === 1 ? dataParts[0] : dataParts, files };
}

const TEXT_OUTPUT_KEYS = ["answer", "response", "text", "output", "message", "result"] as const;

/**
 * A run's output as artifact parts: text as a text part; an object as a data part, led by a text part when it has a
 * text answer (`answer`, `response`, `text`, ...); nothing for an empty output.
 */
export function a2aOutputParts(output: unknown): A2APart[] {
  if (output === undefined || output === null) return [];
  if (typeof output === "string") return output.length > 0 ? [{ text: output }] : [];
  if (typeof output === "number" || typeof output === "boolean") return [{ text: String(output) }];
  const parts: A2APart[] = [];
  if (typeof output === "object" && !Array.isArray(output)) {
    const record = output as Record<string, unknown>;
    const key = TEXT_OUTPUT_KEYS.find((candidate) => typeof record[candidate] === "string" && (record[candidate] as string).length > 0);
    if (key) parts.push({ text: record[key] as string });
  }
  parts.push({ data: output, mediaType: "application/json" });
  return parts;
}

/** An agent-role status message with one text part. */
export function a2aAgentMessage(text: string, ids: { taskId?: string; contextId?: string; messageId: string }): A2AMessage {
  return {
    messageId: ids.messageId,
    role: "ROLE_AGENT",
    parts: [{ text }],
    ...(ids.taskId ? { taskId: ids.taskId } : {}),
    ...(ids.contextId ? { contextId: ids.contextId } : {})
  };
}

// ---------------------------------------------------------------------------
// L2M executions as tasks
// ---------------------------------------------------------------------------

/** The task state of an L2M execution status. */
export function a2aTaskStateForExecution(status: string): A2ATaskState {
  switch (status) {
    case "success":
    case "partial":
      return "TASK_STATE_COMPLETED";
    case "error":
      return "TASK_STATE_FAILED";
    case "canceled":
      return "TASK_STATE_CANCELED";
    case "waiting_approval":
      return "TASK_STATE_INPUT_REQUIRED";
    default:
      return "TASK_STATE_WORKING";
  }
}

/** What a caller reads while the run waits for a person in L2M. Names no step and no data. */
export const A2A_WAITING_FOR_APPROVAL_MESSAGE =
  "The run is waiting for a person to approve a step in L2M. It continues once they decide; ask for the task again (GetTask) for the outcome.";

// ---------------------------------------------------------------------------
// 0.3 shapes
// ---------------------------------------------------------------------------

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const LEGACY_ROLES: Readonly<Record<string, string>> = { ROLE_USER: "user", ROLE_AGENT: "agent" };

export function toLegacyPart(part: A2APart): Record<string, unknown> {
  const metadata = part.metadata ? { metadata: part.metadata } : {};
  if (typeof part.text === "string") return { kind: "text", text: part.text, ...metadata };
  if (typeof part.url === "string") return { kind: "file", file: { uri: part.url, ...(part.filename ? { name: part.filename } : {}), ...(part.mediaType ? { mimeType: part.mediaType } : {}) }, ...metadata };
  if (typeof part.raw === "string") return { kind: "file", file: { bytes: part.raw, ...(part.filename ? { name: part.filename } : {}), ...(part.mediaType ? { mimeType: part.mediaType } : {}) }, ...metadata };
  return { kind: "data", data: part.data ?? null, ...metadata };
}

/** A part in either version's shape, read as 1.0. */
export function fromLegacyPart(value: unknown): A2APart {
  const part = record(value);
  if (part.kind === undefined) return a2aPartSchema.parse(part);
  const metadata = part.metadata && typeof part.metadata === "object" ? { metadata: part.metadata as Record<string, unknown> } : {};
  if (part.kind === "text") return { text: typeof part.text === "string" ? part.text : "", ...metadata };
  if (part.kind === "file") {
    const file = record(part.file);
    const meta = {
      ...(typeof file.name === "string" ? { filename: file.name } : {}),
      ...(typeof file.mimeType === "string" ? { mediaType: file.mimeType } : {})
    };
    if (typeof file.uri === "string") return { url: file.uri, ...meta, ...metadata };
    return { raw: typeof file.bytes === "string" ? file.bytes : "", ...meta, ...metadata };
  }
  return { data: part.data ?? null, ...metadata };
}

export function toLegacyMessage(message: A2AMessage): Record<string, unknown> {
  return {
    kind: "message",
    messageId: message.messageId,
    role: LEGACY_ROLES[message.role] ?? (message.role === "agent" ? "agent" : "user"),
    parts: message.parts.map(toLegacyPart),
    ...(message.contextId ? { contextId: message.contextId } : {}),
    ...(message.taskId ? { taskId: message.taskId } : {}),
    ...(message.metadata ? { metadata: message.metadata } : {})
  };
}

/** A message in either version's shape, read as 1.0 (throws when it is not a message). */
export function fromLegacyMessage(value: unknown): A2AMessage {
  const message = record(value);
  const role = message.role === "user" ? "ROLE_USER" : message.role === "agent" ? "ROLE_AGENT" : message.role;
  const parts = Array.isArray(message.parts) ? message.parts.map(fromLegacyPart) : message.parts;
  const { kind: _kind, ...rest } = message;
  return a2aMessageSchema.parse({ ...rest, role, parts });
}

function toLegacyArtifact(artifact: A2AArtifact): Record<string, unknown> {
  return { ...artifact, parts: artifact.parts.map(toLegacyPart) };
}

function toLegacyStatus(status: A2ATaskStatus): Record<string, unknown> {
  return {
    state: legacyTaskState(status.state),
    ...(status.message ? { message: toLegacyMessage(status.message) } : {}),
    ...(status.timestamp ? { timestamp: status.timestamp } : {})
  };
}

export function toLegacyTask(task: A2ATask): Record<string, unknown> {
  return {
    kind: "task",
    id: task.id,
    contextId: task.contextId ?? "",
    status: toLegacyStatus(task.status),
    ...(task.artifacts ? { artifacts: task.artifacts.map(toLegacyArtifact) } : {}),
    ...(task.history ? { history: task.history.map(toLegacyMessage) } : {}),
    ...(task.metadata ? { metadata: task.metadata } : {})
  };
}

/** A stream event in 0.3's shape: the bare object with its `kind` (status updates say whether they are the last). */
export function toLegacyStreamEvent(event: A2AStreamResponse): Record<string, unknown> {
  if ("task" in event) return toLegacyTask(event.task);
  if ("message" in event) return toLegacyMessage(event.message);
  if ("statusUpdate" in event) {
    const update = event.statusUpdate;
    return {
      kind: "status-update",
      taskId: update.taskId,
      contextId: update.contextId,
      status: toLegacyStatus(update.status),
      final: isTerminalTaskState(update.status.state) || isInterruptedTaskState(update.status.state),
      ...(update.metadata ? { metadata: update.metadata } : {})
    };
  }
  const update = event.artifactUpdate;
  return {
    kind: "artifact-update",
    taskId: update.taskId,
    contextId: update.contextId,
    artifact: toLegacyArtifact(update.artifact),
    ...(update.append !== undefined ? { append: update.append } : {}),
    ...(update.lastChunk !== undefined ? { lastChunk: update.lastChunk } : {})
  };
}

function readArtifact(value: unknown): A2AArtifact {
  const artifact = record(value);
  return {
    artifactId: typeof artifact.artifactId === "string" ? artifact.artifactId : "",
    ...(typeof artifact.name === "string" ? { name: artifact.name } : {}),
    ...(typeof artifact.description === "string" ? { description: artifact.description } : {}),
    parts: Array.isArray(artifact.parts) ? artifact.parts.map(fromLegacyPart) : [],
    ...(artifact.metadata && typeof artifact.metadata === "object" ? { metadata: artifact.metadata as Record<string, unknown> } : {})
  };
}

function readStatus(value: unknown): A2ATaskStatus {
  const status = record(value);
  let message: A2AMessage | undefined;
  if (status.message !== undefined && status.message !== null) {
    try {
      message = fromLegacyMessage(status.message);
    } catch {
      message = undefined;
    }
  }
  return {
    state: readTaskState(status.state),
    ...(message ? { message } : {}),
    ...(typeof status.timestamp === "string" ? { timestamp: status.timestamp } : {})
  };
}

/** A task in either version's shape, read as 1.0; null when it is not a task (no id or no status). */
export function readA2ATask(value: unknown): A2ATask | null {
  const task = record(value);
  if (typeof task.id !== "string" || !task.id || !task.status || typeof task.status !== "object") return null;
  const history: A2AMessage[] = [];
  for (const entry of Array.isArray(task.history) ? task.history : []) {
    try {
      history.push(fromLegacyMessage(entry));
    } catch {
      // A history entry this client cannot read is left out.
    }
  }
  return {
    id: task.id,
    ...(typeof task.contextId === "string" && task.contextId ? { contextId: task.contextId } : {}),
    status: readStatus(task.status),
    ...(Array.isArray(task.artifacts) ? { artifacts: task.artifacts.map(readArtifact) } : {}),
    ...(history.length > 0 ? { history } : {}),
    ...(task.metadata && typeof task.metadata === "object" ? { metadata: task.metadata as Record<string, unknown> } : {})
  };
}

/**
 * A SendMessage result in either version's shape: 1.0 wraps it (`{task}` or `{message}`), 0.3 returns the object with
 * its `kind`, and some servers return a bare task. Null when it is neither.
 */
export function readA2ASendResult(value: unknown): { task: A2ATask } | { message: A2AMessage } | null {
  const result = record(value);
  if (result.task !== undefined) {
    const task = readA2ATask(result.task);
    return task ? { task } : null;
  }
  if (result.message !== undefined && result.kind === undefined && result.parts === undefined) {
    try {
      return { message: fromLegacyMessage(result.message) };
    } catch {
      return null;
    }
  }
  if (result.kind === "message" || (result.parts !== undefined && result.messageId !== undefined)) {
    try {
      return { message: fromLegacyMessage(result) };
    } catch {
      return null;
    }
  }
  const task = readA2ATask(result);
  return task ? { task } : null;
}
