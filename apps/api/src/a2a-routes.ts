/**
 * Agent2Agent (A2A) — a workflow with an Expose as A2A Agent trigger, served as an A2A agent:
 *
 *   GET  /a2a/:path/.well-known/agent-card.json   its Agent Card (public: discovery needs no token)
 *   POST /a2a/:path                               its A2A JSON-RPC endpoint (A2A 1.0, and the 0.3 method names)
 *   POST /api/a2a/card-preview                    the editor's look at a remote agent's card (builders)
 *
 * The endpoint takes SendMessage, SendStreamingMessage (SSE), GetTask and CancelTask. A task is one production run of
 * the workflow (task id = execution id, context id = session id), started through the run dispatcher like every other
 * production entry point, so budgets, the queue, approvals, content rules on the response, run history and capture
 * apply. Production gating follows the MCP trigger: the published version (or the draft when nothing is published),
 * deactivated and switched-off triggers refused, unfinished versions answered `workflow_unfinished`.
 */
import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  A2A_ERROR_CODES,
  A2A_LEGACY_PROTOCOL_VERSION,
  A2A_PROTOCOL_VERSION,
  A2A_PUSH_METHODS,
  A2A_WAITING_FOR_APPROVAL_MESSAGE,
  CONTENT_FILTER_CODE,
  RESPONSE_WITHHELD_MESSAGE,
  UNKNOWN_AUTH_MODE_CODE,
  a2aAgentMessage,
  a2aJsonRpcError,
  a2aJsonRpcRequestSchema,
  a2aJsonRpcResult,
  a2aMessageInput,
  a2aMethodOf,
  a2aOutputParts,
  a2aSendMessageParamsSchema,
  a2aTaskIdParamsSchema,
  a2aTaskStateForExecution,
  a2aTriggerAuthMode,
  buildA2AAgentCard,
  callerErrorOf,
  fromLegacyMessage,
  isLiveEntryOff,
  isTerminalTaskState,
  liveEntryOffMessage,
  responseRulesApply,
  responseWasWithheld,
  toLegacyStreamEvent,
  toLegacyTask,
  unknownAuthMode,
  unknownAuthModeMessage,
  LIVE_ENTRY_OFF_CODE,
  type A2AArtifact,
  type A2AMessage,
  type A2AStreamResponse,
  type A2ATask,
  type A2ATaskState,
  type SecretReference,
  type Workflow,
  type WorkflowExecutionResult,
  type WorkflowNode
} from "@ai-orchestrator/shared";
import type { A2ARegistry } from "@ai-orchestrator/a2a-sdk";
import { guardedA2AFetch, type OutboundGuardConfig } from "@ai-orchestrator/workflow-engine";
import type { Store } from "./db/store.js";
import type { SafeUser, UserRole } from "./services/auth-service.js";
import { DISPATCH_SPEC_VERSION, DispatchClientGoneError, type DispatchedRunInput, type DispatchedRunSpec, type RunDispatcher } from "./services/run-dispatch.js";
import { startSseHeartbeat } from "./sse-heartbeat.js";
import type { RunCancelOutcome } from "./execution-routes.js";
import { DEACTIVATED_MESSAGE } from "./services/release-service.js";

export const A2A_TRIGGER_TYPE = "a2a";
const AGENT_NOT_FOUND = "A2A agent not found";
/** What a caller reads about a failed run whose details it cannot be shown (stored error text can quote run data). */
const A2A_RUN_FAILED_MESSAGE = "The agent's run failed. Its details are in the run history in L2M.";
const CANCEL_REASON = "Canceled by the A2A caller";

export interface A2aRoutesDeps {
  app: FastifyInstance;
  config: { APP_PUBLIC_URL?: string | undefined; SSE_HEARTBEAT_INTERVAL_MS: number };
  store: Pick<Store, "listWorkflows" | "getExecutionHistory">;
  /** Production's version of a workflow, unfinished included (releaseService.resolveRunnableWorkflow). */
  loadProductionWorkflow: (workflowId: string) => Promise<Workflow | null>;
  /** A deactivated workflow whose production version matches, for a "deactivated" answer to its editors. */
  deactivatedMatch: (matches: (workflow: Workflow) => boolean) => Promise<Workflow | null>;
  signedInEditorOf: (request: FastifyRequest, workflowId: string) => Promise<boolean>;
  /** Why production does not run this (unfinished) version, or null. */
  pausedRefusal: (workflow: Workflow) => Promise<string | null>;
  resolveSecret: (ref: SecretReference) => Promise<string | null | undefined>;
  /** The user an API key in `Authorization: Bearer` acts as, with at least `roles`; or why not. */
  apiKeyCaller: (request: FastifyRequest, roles: UserRole[]) => Promise<{ ok: true; user: SafeUser } | { ok: false; status: number; error: string }>;
  mayExecute: (user: SafeUser, workflowId: string) => Promise<boolean>;
  requireRole: (request: FastifyRequest, reply: FastifyReply, roles: UserRole[]) => Promise<SafeUser | null>;
  runDispatcher: Pick<RunDispatcher, "run" | "start">;
  dispatchPoolOf: (workflow: Workflow) => string;
  admitRunBudget: (run: Pick<DispatchedRunInput, "workflow" | "triggerType" | "triggeredBy" | "policyActor">) => Promise<void>;
  cancelRun: (execution: { id: string; status: string }, reason: string) => Promise<RunCancelOutcome>;
  a2aRegistry: A2ARegistry;
  outboundGuard: OutboundGuardConfig;
  safeEqual: (expected: string, provided: string) => boolean;
  log: { warn: (fields: Record<string, unknown>, message: string) => void };
}

type RpcId = string | number | null;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function header(request: FastifyRequest, name: string): string {
  const value = request.headers[name.toLowerCase()];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function rpcIdOf(body: unknown): RpcId {
  const id = record(body).id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

/** JSON-RPC error codes for refusals at the HTTP layer (the status says what happened; the body stays JSON-RPC). */
function refusalCode(status: number): number {
  if (status === 404) return A2A_ERROR_CODES.methodNotFound;
  if (status >= 500) return A2A_ERROR_CODES.internalError;
  return A2A_ERROR_CODES.invalidRequest;
}

export function registerA2aRoutes(deps: A2aRoutesDeps): void {
  const { app } = deps;
  /** Tasks started with returnImmediately whose first history record may not be written yet. */
  const pending = new Map<string, { workflowId: string; contextId: string; path: string }>();

  const triggerFor = (workflow: Workflow, path: string): WorkflowNode | null =>
    workflow.nodes.find((node) => node.type === "a2a_trigger" && node.disabled !== true && typeof record(node.config).path === "string" && String(record(node.config).path).trim() === path) ??
    null;

  const findAgent = async (path: string): Promise<{ workflow: Workflow; node: WorkflowNode } | null> => {
    for (const summary of await deps.store.listWorkflows()) {
      const workflow = await deps.loadProductionWorkflow(summary.id);
      if (!workflow) continue;
      const node = triggerFor(workflow, path);
      if (node) return { workflow, node };
    }
    return null;
  };

  /** Why there is no agent at this path: deactivated (409, told only to its editors) or not found (404). */
  const missing = async (request: FastifyRequest, path: string): Promise<{ status: number; message: string }> => {
    const deactivated = await deps.deactivatedMatch((workflow) => triggerFor(workflow, path) !== null);
    const tell = deactivated !== null && (await deps.signedInEditorOf(request, deactivated.id));
    return tell ? { status: 409, message: DEACTIVATED_MESSAGE } : { status: 404, message: AGENT_NOT_FOUND };
  };

  const baseUrlOf = (request: FastifyRequest): string => {
    const configured = deps.config.APP_PUBLIC_URL?.trim();
    if (configured) return configured.replace(/\/+$/, "");
    return `${request.protocol}://${String(request.headers.host ?? "localhost")}`;
  };

  const refuse = (reply: FastifyReply, id: RpcId, status: number, message: string, code?: string) => {
    reply.code(status);
    if (status === 401) reply.header("WWW-Authenticate", 'Bearer realm="a2a"');
    return a2aJsonRpcError(id, refusalCode(status), message, code ? { code } : undefined);
  };

  /** The caller may send this agent tasks: the trigger's Auth Mode. */
  const authorize = async (
    request: FastifyRequest,
    found: { workflow: Workflow; node: WorkflowNode }
  ): Promise<{ ok: true; user: SafeUser | null } | { ok: false; status: number; message: string; code?: string }> => {
    const config = record(found.node.config);
    const mode = a2aTriggerAuthMode(config);
    if (mode === "public") return { ok: true, user: null };
    const authorization = header(request, "authorization");
    const token = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
    if (mode === "bearer") {
      const secretId = typeof record(config.secretRef).secretId === "string" ? String(record(config.secretRef).secretId).trim() : "";
      if (!secretId) return { ok: false, status: 401, message: "This agent asks for a bearer token, but no token secret is picked on its trigger yet", code: "token_not_set" };
      const secret = await deps.resolveSecret({ secretId });
      if (!secret) return { ok: false, status: 500, message: "The agent's bearer secret is not configured" };
      if (!token || !deps.safeEqual(secret, token)) return { ok: false, status: 401, message: "Invalid bearer token" };
      return { ok: true, user: null };
    }
    if (!token) return { ok: false, status: 401, message: "This agent takes an L2M API key as a bearer token" };
    const caller = await deps.apiKeyCaller(request, ["operator"]);
    if (!caller.ok) return { ok: false, status: caller.status === 403 ? 403 : 401, message: caller.status === 403 ? caller.error : "Invalid API key" };
    if (!(await deps.mayExecute(caller.user, found.workflow.id))) return { ok: false, status: 403, message: "This API key may not run this agent's workflow" };
    return { ok: true, user: caller.user };
  };

  const statusMessage = (text: string, task: { id: string; contextId: string }): A2AMessage =>
    a2aAgentMessage(text, { messageId: crypto.randomUUID(), taskId: task.id, contextId: task.contextId });

  const outputArtifact = (output: unknown): A2AArtifact[] => {
    const parts = a2aOutputParts(output);
    return parts.length > 0 ? [{ artifactId: "output", name: "output", parts }] : [];
  };

  /** A finished (or paused) run, as the task the caller reads. */
  const taskFromResult = (result: WorkflowExecutionResult, ids: { id: string; contextId: string }, sent?: A2AMessage): A2ATask => {
    const timestamp = result.completedAt || new Date().toISOString();
    const base = { id: ids.id, contextId: ids.contextId, ...(sent ? { history: [sent] } : {}) };
    if (responseWasWithheld(result)) {
      return { ...base, status: { state: "TASK_STATE_FAILED", message: statusMessage(RESPONSE_WITHHELD_MESSAGE, ids), timestamp }, metadata: { code: CONTENT_FILTER_CODE } };
    }
    const state: A2ATaskState = a2aTaskStateForExecution(result.status);
    if (state === "TASK_STATE_INPUT_REQUIRED") return { ...base, status: { state, message: statusMessage(A2A_WAITING_FOR_APPROVAL_MESSAGE, ids), timestamp } };
    if (state === "TASK_STATE_FAILED") return { ...base, status: { state, message: statusMessage(callerErrorOf(result, A2A_RUN_FAILED_MESSAGE), ids), timestamp } };
    if (state === "TASK_STATE_CANCELED") return { ...base, status: { state, timestamp } };
    // An agent that asked the caller a question (agent_clarify) needs more input; while response rules apply the
    // question (unchecked run data) is not shown.
    if (result.clarification) {
      const question = responseRulesApply(result) ? "The agent needs more information. Send a new message in the same context." : result.clarification.question;
      return { ...base, status: { state: "TASK_STATE_INPUT_REQUIRED", message: statusMessage(question, ids), timestamp } };
    }
    return { ...base, status: { state: "TASK_STATE_COMPLETED", timestamp }, artifacts: outputArtifact(result.output) };
  };

  type HistoryRecord = NonNullable<Awaited<ReturnType<A2aRoutesDeps["store"]["getExecutionHistory"]>>>;

  /** A stored run of this agent, or null when the id is not one of its tasks. */
  const agentRun = async (id: string, found: { workflow: Workflow }, path: string): Promise<HistoryRecord | null> => {
    const history = await deps.store.getExecutionHistory(id);
    if (!history || history.workflowId !== found.workflow.id || history.triggerType !== A2A_TRIGGER_TYPE) return null;
    const stored = record(record(history.input).a2a);
    if (typeof stored.path === "string" && stored.path !== path) return null;
    return history;
  };

  const contextOf = (history: HistoryRecord): string => {
    const stored = record(record(history.input).a2a);
    return typeof stored.contextId === "string" ? stored.contextId : "";
  };

  /** A stored run as a task. A failure says only that it failed: the stored error can quote run data. */
  const taskFromHistory = (history: HistoryRecord): A2ATask => {
    const ids = { id: history.id, contextId: contextOf(history) };
    const timestamp = history.completedAt ?? history.startedAt;
    const output = record(history.output);
    if (output.code === CONTENT_FILTER_CODE) {
      return { ...ids, status: { state: "TASK_STATE_FAILED", message: statusMessage(RESPONSE_WITHHELD_MESSAGE, ids), timestamp }, metadata: { code: CONTENT_FILTER_CODE } };
    }
    const state = a2aTaskStateForExecution(history.status === "partial" && !history.completedAt ? "running" : history.status);
    if (state === "TASK_STATE_INPUT_REQUIRED") return { ...ids, status: { state, message: statusMessage(A2A_WAITING_FOR_APPROVAL_MESSAGE, ids), timestamp } };
    if (state === "TASK_STATE_FAILED") return { ...ids, status: { state, message: statusMessage(A2A_RUN_FAILED_MESSAGE, ids), timestamp } };
    if (state === "TASK_STATE_COMPLETED") return { ...ids, status: { state, timestamp }, artifacts: outputArtifact(history.output) };
    return { ...ids, status: { state, timestamp } };
  };

  const shapeTask = (task: A2ATask, legacy: boolean): unknown => (legacy ? toLegacyTask(task) : { task });
  const shapeBareTask = (task: A2ATask, legacy: boolean): unknown => (legacy ? toLegacyTask(task) : task);

  app.get<{ Params: { path: string } }>("/a2a/:path/.well-known/agent-card.json", async (request, reply) => {
    const found = await findAgent(request.params.path);
    if (!found) {
      const why = await missing(request, request.params.path);
      reply.code(why.status);
      return { error: why.message };
    }
    if (isLiveEntryOff(found.node)) {
      reply.code(404);
      return (await deps.signedInEditorOf(request, found.workflow.id)) ? { error: liveEntryOffMessage("a2a_trigger"), code: LIVE_ENTRY_OFF_CODE } : { error: AGENT_NOT_FOUND };
    }
    const config = record(found.node.config);
    const name = typeof config.agentName === "string" && config.agentName.trim() ? config.agentName.trim() : found.workflow.name;
    const description =
      typeof config.agentDescription === "string" && config.agentDescription.trim()
        ? config.agentDescription.trim()
        : typeof found.workflow.description === "string"
          ? found.workflow.description
          : "";
    reply.header("Cache-Control", "no-cache");
    return buildA2AAgentCard({
      name,
      description,
      endpointUrl: `${baseUrlOf(request)}/a2a/${encodeURIComponent(request.params.path)}`,
      skillId: request.params.path,
      authMode: a2aTriggerAuthMode(config),
      version: String(found.workflow.workflowVersion ?? 1)
    });
  });

  app.post<{ Params: { path: string }; Body: unknown }>("/a2a/:path", async (request, reply) => {
    const path = request.params.path;
    const id = rpcIdOf(request.body);
    const found = await findAgent(path);
    if (!found) {
      const why = await missing(request, path);
      return refuse(reply, id, why.status, why.message);
    }
    if (isLiveEntryOff(found.node)) {
      const tell = await deps.signedInEditorOf(request, found.workflow.id);
      return refuse(reply, id, 404, tell ? liveEntryOffMessage("a2a_trigger") : AGENT_NOT_FOUND, tell ? LIVE_ENTRY_OFF_CODE : undefined);
    }
    const unknownMode = unknownAuthMode(found.node);
    if (unknownMode !== null) return refuse(reply, id, 500, unknownAuthModeMessage(unknownMode), UNKNOWN_AUTH_MODE_CODE);
    const auth = await authorize(request, found);
    if (!auth.ok) return refuse(reply, id, auth.status, auth.message, auth.code);

    const rpc = a2aJsonRpcRequestSchema.safeParse(request.body);
    if (!rpc.success) return a2aJsonRpcError(id, A2A_ERROR_CODES.invalidRequest, "Not a JSON-RPC 2.0 request");
    const versionHeader = header(request, "a2a-version");
    if (versionHeader && versionHeader !== A2A_PROTOCOL_VERSION && versionHeader !== A2A_LEGACY_PROTOCOL_VERSION && !/^(1\.0|0\.3)\.\d+$/.test(versionHeader)) {
      return a2aJsonRpcError(id, A2A_ERROR_CODES.versionNotSupported, `A2A version ${versionHeader.slice(0, 20)} is not supported; this agent speaks ${A2A_PROTOCOL_VERSION} and ${A2A_LEGACY_PROTOCOL_VERSION}`);
    }
    if (A2A_PUSH_METHODS.has(rpc.data.method)) {
      return a2aJsonRpcError(id, A2A_ERROR_CODES.pushNotificationNotSupported, "Push notifications are not supported");
    }
    const method = a2aMethodOf(rpc.data.method);
    if (!method) return a2aJsonRpcError(id, A2A_ERROR_CODES.methodNotFound, `Method ${rpc.data.method.slice(0, 80)} is not supported`);
    const legacy = method.legacy;
    const params = record(rpc.data.params);

    if (method.kind === "get" || method.kind === "cancel") {
      const parsed = a2aTaskIdParamsSchema.safeParse(params);
      if (!parsed.success) return a2aJsonRpcError(id, A2A_ERROR_CODES.invalidParams, "params.id (the task id) is required");
      const taskId = parsed.data.id;
      const inFlight = pending.get(taskId);
      const history = await agentRun(taskId, found, path);
      if (!history) {
        if (inFlight && inFlight.workflowId === found.workflow.id && inFlight.path === path) {
          if (method.kind === "cancel") return a2aJsonRpcError(id, A2A_ERROR_CODES.taskNotCancelable, "The task is starting; cancel it again in a moment");
          return a2aJsonRpcResult(id, shapeBareTask({ id: taskId, contextId: inFlight.contextId, status: { state: "TASK_STATE_WORKING" } }, legacy));
        }
        return a2aJsonRpcError(id, A2A_ERROR_CODES.taskNotFound, "Task not found");
      }
      if (method.kind === "get") return a2aJsonRpcResult(id, shapeBareTask(taskFromHistory(history), legacy));
      const current = taskFromHistory(history);
      if (isTerminalTaskState(current.status.state)) return a2aJsonRpcError(id, A2A_ERROR_CODES.taskNotCancelable, "The task has already ended");
      const outcome = await deps.cancelRun({ id: history.id, status: history.status }, CANCEL_REASON);
      if (outcome.kind === "missing") return a2aJsonRpcError(id, A2A_ERROR_CODES.taskNotFound, "Task not found");
      if (outcome.kind !== "canceled") return a2aJsonRpcError(id, A2A_ERROR_CODES.taskNotCancelable, "The task can no longer be canceled");
      const after = await agentRun(taskId, found, path);
      return a2aJsonRpcResult(id, shapeBareTask(after ? taskFromHistory(after) : { ...current, status: { state: "TASK_STATE_CANCELED", timestamp: outcome.completedAt } }, legacy));
    }

    // SendMessage / SendStreamingMessage.
    let message: A2AMessage;
    let returnImmediately = false;
    let acceptedOutputModes: string[] | undefined;
    try {
      const parsed = a2aSendMessageParamsSchema.parse({ ...params, message: fromLegacyMessage(params.message) });
      message = parsed.message;
      returnImmediately = parsed.configuration?.returnImmediately === true || parsed.configuration?.blocking === false;
      acceptedOutputModes = parsed.configuration?.acceptedOutputModes;
    } catch {
      return a2aJsonRpcError(id, A2A_ERROR_CODES.invalidParams, "params.message must be an A2A message with a messageId, a role and parts");
    }
    if (message.taskId) {
      return a2aJsonRpcError(
        id,
        A2A_ERROR_CODES.unsupportedOperation,
        "This agent does not take follow-up messages for a task. A task waiting for an approval continues once a person decides in L2M; send a new message (in the same context) for a new task."
      );
    }
    if (acceptedOutputModes && acceptedOutputModes.length > 0 && !acceptedOutputModes.some((mode) => /^(text\/plain|application\/json|text\/\*|\*\/\*|text|data)$/i.test(mode.trim()))) {
      return a2aJsonRpcError(id, A2A_ERROR_CODES.contentTypeNotSupported, "This agent answers in text/plain and application/json");
    }
    const input = a2aMessageInput(message);
    if (!input.text.trim() && input.data === undefined) {
      return a2aJsonRpcError(id, A2A_ERROR_CODES.invalidParams, "The message has no text or data part");
    }
    // Production's version has unfinished settings: no run starts (the caller already passed the token check).
    const paused = await deps.pausedRefusal(found.workflow);
    if (paused) return refuse(reply, id, 409, paused, "workflow_unfinished");

    const executionId = crypto.randomUUID();
    const contextId = message.contextId?.trim() || crypto.randomUUID();
    const sent: A2AMessage = { ...message, contextId, taskId: executionId };
    const ids = { id: executionId, contextId };
    const a2aInput = {
      path,
      messageId: message.messageId,
      contextId,
      text: input.text,
      ...(input.data !== undefined ? { data: input.data } : {}),
      ...(input.files.length > 0 ? { files: input.files } : {})
    };
    const requestInput = { a2a: a2aInput };
    // The channel is named at each dispatch below (the release audit reads it there).
    const spec: Omit<DispatchedRunSpec, "run"> & { run: Omit<DispatchedRunInput, "channel"> } = {
      v: DISPATCH_SPEC_VERSION,
      run: {
        workflow: found.workflow,
        directInput: { trigger_type: A2A_TRIGGER_TYPE, trigger_node_id: found.node.id, user_prompt: input.text, a2a: a2aInput },
        sessionId: contextId,
        ...(input.text ? { userPrompt: input.text } : {}),
        executionId,
        triggerType: A2A_TRIGGER_TYPE,
        triggeredBy: auth.user ? auth.user.email : "a2a-client",
        ...(auth.user ? { policyActor: auth.user } : {}),
        // Phase 12 coverage — the calling agent receives the output.
        responseBoundary: { surface: "a2a" }
      },
      progress: { requestInput },
      history: { requestInput }
    };
    const pool = deps.dispatchPoolOf(found.workflow);

    if (method.kind === "send") {
      if (returnImmediately) {
        await deps.admitRunBudget({ ...spec.run });
        pending.set(executionId, { workflowId: found.workflow.id, contextId, path });
        const started = await deps.runDispatcher.start({ ...spec, run: { channel: "production", ...spec.run } }, { pool, admitted: true, recordQueued: true }).catch((error: unknown) => {
          pending.delete(executionId);
          throw error;
        });
        if (started.queued) pending.delete(executionId);
        else {
          void started.done
            .catch((error: unknown) => deps.log.warn({ executionId, error: error instanceof Error ? error.message : String(error) }, "An A2A task's run failed to finish"))
            .finally(() => pending.delete(executionId));
        }
        return a2aJsonRpcResult(id, shapeTask({ ...ids, status: { state: "TASK_STATE_WORKING", timestamp: new Date().toISOString() }, history: [sent] }, legacy));
      }
      const result = await deps.runDispatcher.run({ ...spec, run: { channel: "production", ...spec.run } }, { pool });
      return a2aJsonRpcResult(id, shapeTask(taskFromResult(result, ids, sent), legacy));
    }

    // SendStreamingMessage: the budget is checked before the stream opens (a refusal is an HTTP 402, not an event).
    await deps.admitRunBudget(spec.run);
    let streamClosed = false;
    let markClientGone: () => void = () => undefined;
    const clientGone = new Promise<void>((resolve) => {
      markClientGone = resolve;
    });
    request.raw.on("close", () => {
      streamClosed = true;
      markClientGone();
    });
    const send = (event: A2AStreamResponse) => {
      if (streamClosed) return;
      reply.raw.write(`data: ${JSON.stringify(a2aJsonRpcResult(id, legacy ? toLegacyStreamEvent(event) : event))}\n\n`);
    };
    reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
    if (typeof reply.raw.flushHeaders === "function") reply.raw.flushHeaders();
    const stopHeartbeat = startSseHeartbeat(reply.raw, deps.config.SSE_HEARTBEAT_INTERVAL_MS, () => streamClosed);
    send({ task: { ...ids, status: { state: "TASK_STATE_SUBMITTED", timestamp: new Date().toISOString() }, history: [sent] } });
    send({ statusUpdate: { taskId: executionId, contextId, status: { state: "TASK_STATE_WORKING", timestamp: new Date().toISOString() } } });
    try {
      const result = await deps.runDispatcher.run({ ...spec, run: { channel: "production", ...spec.run } }, { pool, admitted: true, closed: clientGone });
      const task = taskFromResult(result, ids);
      for (const artifact of task.artifacts ?? []) send({ artifactUpdate: { taskId: executionId, contextId, artifact, lastChunk: true } });
      send({ statusUpdate: { taskId: executionId, contextId, status: task.status, ...(task.metadata ? { metadata: task.metadata } : {}) } });
    } catch (error) {
      if (!(error instanceof DispatchClientGoneError)) {
        deps.log.warn({ executionId, error: error instanceof Error ? error.message : String(error) }, "An A2A stream's run did not finish");
        send({ statusUpdate: { taskId: executionId, contextId, status: { state: "TASK_STATE_FAILED", message: statusMessage(A2A_RUN_FAILED_MESSAGE, ids), timestamp: new Date().toISOString() } } });
      }
    } finally {
      stopHeartbeat();
      if (!streamClosed) reply.raw.end();
    }
    return reply;
  });

  // The editor's look at a remote agent: its card, read through the outbound URL guard. Cards are public, so no
  // token is sent.
  app.post<{ Body: unknown }>("/api/a2a/card-preview", async (request, reply) => {
    const user = await deps.requireRole(request, reply, ["builder"]);
    if (!user) return;
    const cardUrl = typeof record(request.body).cardUrl === "string" ? String(record(request.body).cardUrl).trim() : "";
    if (!cardUrl) {
      reply.code(400);
      return { error: "cardUrl is required" };
    }
    const adapter = deps.a2aRegistry.resolve(cardUrl);
    if (!adapter) {
      reply.code(400);
      return { error: "The agent URL must start with http:// or https://" };
    }
    try {
      const agent = await adapter.resolveAgent(cardUrl, { fetch: guardedA2AFetch({ outboundGuard: deps.outboundGuard }), signal: AbortSignal.timeout(10_000) });
      const card = agent.card;
      return {
        cardUrl: agent.cardUrl,
        name: card.name,
        description: card.description ?? "",
        version: card.version ?? null,
        endpoint: agent.endpoint.url,
        protocolVersion: agent.endpoint.version,
        streaming: card.capabilities?.streaming === true,
        securitySchemes: Object.keys(card.securitySchemes ?? {}),
        skills: (card.skills ?? []).slice(0, 50).map((skill) => ({ id: skill.id ?? "", name: skill.name ?? "", description: skill.description ?? "" }))
      };
    } catch (error) {
      reply.code(502);
      return { error: error instanceof Error ? error.message.slice(0, 300) : "The agent card could not be read" };
    }
  });
}
