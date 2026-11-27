/**
 * Where a node added from the palette goes and what it is connected to: after the selected node (or the output whose
 * `+` was clicked), to the right of it and clear of other nodes, joined by an edge from that node's first free output.
 */
import { ORBIT, isHubType } from "./stages";
import { AUXILIARY_HANDLES, validateConnection, type RuleEdge, type RuleNode } from "./connection-rules";
import { ERROR_OUTPUT_HANDLE } from "./error-output";

export interface InsertNode {
  id: string;
  position: { x: number; y: number };
  width?: number | null;
  height?: number | null;
  data: { nodeType: string; config?: Record<string, unknown> };
}

export interface InsertEdge {
  source: string;
  target: string;
  sourceHandle?: string | null;
}

export interface Point {
  x: number;
  y: number;
}

/** Horizontal gap between a node and the node inserted after it. */
export const INSERT_GAP_X = 80;
/** Vertical step between rows (one card plus a gap). */
export const INSERT_ROW_STEP = ORBIT.cardHeight + 24;
const OVERLAP_MARGIN = 16;
/** Room a new agent keeps around its centre for its rings (it has nothing attached yet). */
const NEW_HUB_REACH = ORBIT.outerRadius + ORBIT.satelliteSize / 2;

const FIXED_SOURCE_HANDLES: Record<string, string[]> = {
  if_node: ["true", "false"],
  try_catch: ["success", "error"],
  guard: ["pass", "blocked", "review"],
  approval_gate: ["approved", "rejected", "timed_out"],
  // Pass / Stopped (Pass or stop), Kept / Rejected (items mode): the same two handles, so a mode change keeps edges.
  filter_node: ["pass", "filtered"],
  chat_intent_router: ["report", "code", "message", "missing_context"]
};

/** Node types that sit on an agent's ports (model, memory, tools, content rules) rather than in its steps. */
const AGENT_PORT_TYPES = new Set([
  "llm_call",
  "openai_chat_model",
  "anthropic_chat_model",
  "ollama_chat_model",
  "openai_compatible_chat_model",
  "ai_gateway_chat_model",
  "azure_openai_chat_model",
  "google_gemini_chat_model",
  "local_memory",
  "mcp_tool",
  "workflow_tool",
  "guard",
  "guard_protection"
]);

/** Start nodes: they take no incoming step edge. */
const INPUT_TYPES = new Set(["webhook_input", "text_input", "system_prompt", "user_prompt", "mcp_server_trigger"]);

function isInputType(type: string): boolean {
  return INPUT_TYPES.has(type) || type.endsWith("_trigger");
}

/** The node's output handles in the order the canvas draws them; `null` is the single main output. */
export function sourceHandleIds(node: InsertNode): Array<string | null> {
  const type = node.data.nodeType;
  const fixed = FIXED_SOURCE_HANDLES[type];
  if (fixed) return [...fixed];
  if (type === "switch_node") {
    const cases = Array.isArray(node.data.config?.cases) ? (node.data.config?.cases as unknown[]) : [];
    const ids = cases.map((entry, index) => {
      const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
      const raw = typeof entry === "string" ? entry : (record?.label ?? record?.value ?? `Case ${index + 1}`);
      return String(raw ?? "").trim() || `case_${index}`;
    });
    return [...ids, "default"];
  }
  return [null];
}

/** The first output of `node` with no outgoing edge, else its first output. */
export function chooseSourceHandle(node: InsertNode, edges: readonly InsertEdge[]): string | null {
  const handles = sourceHandleIds(node);
  // A Filter's edge saved without a handle (from before it had two outputs) is drawn from its first output.
  const unlabeled = node.data.nodeType === "filter_node" && !handles.includes(null) ? handles[0] ?? null : null;
  const used = new Set(edges.filter((edge) => edge.source === node.id).map((edge) => edge.sourceHandle ?? unlabeled));
  return handles.find((handle) => !used.has(handle)) ?? handles[0] ?? null;
}

/**
 * Whether a node of `targetType` added after a node of `sourceType` is offered an edge at all (start nodes, sticky
 * notes and an agent's port nodes are simply placed). An offered edge still goes through the editor's connection
 * rules (`validateConnection`), which may refuse it with a notice.
 */
export function canAutoConnect(sourceType: string, targetType: string, sourceHandle: string | null = null): boolean {
  if (sourceType === "sticky_note" || targetType === "sticky_note") return false;
  if (isInputType(targetType)) return false;
  // A node added after an agent's Error output is a step (the fallback), never one of its ports.
  if (isHubType(sourceType) && AGENT_PORT_TYPES.has(targetType) && sourceHandle !== ERROR_OUTPUT_HANDLE) return false;
  return true;
}

function sizeOf(node: InsertNode): { width: number; height: number } {
  const hub = isHubType(node.data.nodeType);
  return {
    width: node.width ?? (hub ? ORBIT.hubSize : ORBIT.cardWidth),
    height: node.height ?? (hub ? ORBIT.hubSize : ORBIT.cardHeight)
  };
}

function overlaps(spot: Point, nodes: readonly InsertNode[]): boolean {
  return nodes.some((other) => {
    const size = sizeOf(other);
    return (
      spot.x < other.position.x + size.width + OVERLAP_MARGIN &&
      spot.x + ORBIT.cardWidth + OVERLAP_MARGIN > other.position.x &&
      spot.y < other.position.y + size.height + OVERLAP_MARGIN &&
      spot.y + ORBIT.cardHeight + OVERLAP_MARGIN > other.position.y
    );
  });
}

/** `candidate`, or the first spot below it (one row at a time) that no node covers. */
export function findFreePosition(candidate: Point, nodes: readonly InsertNode[]): Point {
  let spot = { ...candidate };
  for (let step = 0; step < 200 && overlaps(spot, nodes); step += 1) {
    spot = { x: spot.x, y: spot.y + INSERT_ROW_STEP };
  }
  return spot;
}

/**
 * Where a node inserted after `source`'s `handle` goes: to its right, on that output's row, clear of `nodes`. A new
 * agent (`insertedType`) keeps room for its rings, so they do not cover the node it follows.
 */
export function insertPositionAfter(source: InsertNode, handle: string | null, nodes: readonly InsertNode[], insertedType?: string): Point {
  const handles = sourceHandleIds(source);
  // The Error output sits below the node's other outputs, so its node goes on the row after theirs.
  const index = handle === ERROR_OUTPUT_HANDLE && !handles.includes(handle) ? handles.length : Math.max(0, handles.indexOf(handle));
  const hub = insertedType !== undefined && isHubType(insertedType);
  const candidate = {
    x: source.position.x + sizeOf(source).width + INSERT_GAP_X + (hub ? NEW_HUB_REACH - ORBIT.hubSize / 2 : 0),
    y: source.position.y + index * INSERT_ROW_STEP + (hub ? Math.round((sizeOf(source).height - ORBIT.hubSize) / 2) : 0)
  };
  return findFreePosition(candidate, nodes);
}

export type InsertConnectionPlan =
  | { kind: "connect"; sourceHandle: string | null }
  | { kind: "place" }
  | { kind: "refused"; message: string };

/**
 * Whether a node inserted after `source`'s `handle` gets an edge: none for nodes that are only placed, else the
 * verdict of the editor's connection rules (the same ones a dragged connection goes through).
 */
export function planInsertConnection(
  source: RuleNode,
  handle: string | null,
  inserted: RuleNode,
  nodes: readonly RuleNode[],
  edges: readonly RuleEdge[]
): InsertConnectionPlan {
  if (!canAutoConnect(source.data.nodeType, inserted.data.nodeType, handle)) return { kind: "place" };
  const verdict = validateConnection({ source: source.id, target: inserted.id, sourceHandle: handle }, [...nodes, inserted], edges);
  return verdict.ok ? { kind: "connect", sourceHandle: verdict.sourceHandle } : { kind: "refused", message: verdict.message };
}


/** Templates that only read what the run started with: the prompt, the trigger's data. */
const TRIGGER_TEMPLATE = /^\s*\{\{\s*(user_prompt|system_prompt|input|webhook|trigger|payload|body)(?:\.[\w.]+)?\s*\}\}\s*$/;

/** Whether an Output template shows only the run's input: the prompt or trigger data, or the start node's own result. */
function readsTrigger(template: string, source: InsertNode): boolean {
  if (TRIGGER_TEMPLATE.test(template)) return true;
  if (!isInputType(source.data.nodeType)) return false;
  const id = source.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*\\{\\{\\s*(?:results\\.)?${id}(?:\\.[\\w.]+)?\\s*\\}\\}\\s*$`).test(template);
}

export interface SplicePlan {
  /** The edge the new node goes into; it is replaced by source → new and new → target. */
  replaced: InsertEdge;
  /** The output of the new node that leads on to the target (`null` = its main output). */
  outgoingHandle: string | null;
  /** Where the new node goes: where the old target started, centred on its row. */
  position: Point;
  /** New positions of the target and every node after it, moved right to make room. */
  moved: Record<string, Point>;
  /** The target Output's new template, when it read the trigger and the new node is an agent (it shows the answer). */
  outputTemplate?: string;
}

function isStepEdge(edge: InsertEdge): boolean {
  return !edge.sourceHandle || (!AUXILIARY_HANDLES.has(edge.sourceHandle) && edge.sourceHandle !== ERROR_OUTPUT_HANDLE);
}

/** `startId` and every node after it on step edges, with the nodes attached to them (their rings move along). */
function downstreamOf(startId: string, edges: readonly InsertEdge[]): Set<string> {
  const out = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const edge of edges) {
      if (edge.source !== id || out.has(edge.target)) continue;
      out.add(edge.target);
      queue.push(edge.target);
    }
  }
  return out;
}

/**
 * When the output a node is added after already leads to exactly one node, the new node goes into that edge
 * (source → new → target) instead of starting a parallel branch. Null when the output has no edge or several, or the
 * new node cannot lead on to the target (a start node, a node only placed, or an edge the connection rules refuse).
 */
export function planSplice(
  source: InsertNode & RuleNode,
  handle: string | null,
  inserted: RuleNode & { data: RuleNode["data"] & { config?: Record<string, unknown> } },
  nodes: ReadonlyArray<InsertNode & RuleNode>,
  edges: readonly InsertEdge[]
): SplicePlan | null {
  const unlabeled = source.data.nodeType === "filter_node" && !sourceHandleIds(source).includes(null) ? sourceHandleIds(source)[0] ?? null : null;
  const leaving = edges.filter((edge) => edge.source === source.id && isStepEdge(edge) && (edge.sourceHandle ?? unlabeled) === handle);
  if (leaving.length !== 1) return null;
  const replaced = leaving[0]!;
  const target = nodes.find((node) => node.id === replaced.target);
  if (!target || isInputType(inserted.data.nodeType) || !canAutoConnect(source.data.nodeType, inserted.data.nodeType, handle)) return null;
  if (!canAutoConnect(inserted.data.nodeType, target.data.nodeType)) return null;
  const outgoing = sourceHandleIds({ id: inserted.id, position: { x: 0, y: 0 }, data: inserted.data })[0] ?? null;
  const remaining = edges.filter((edge) => edge !== replaced);
  const verdict = validateConnection({ source: inserted.id, target: target.id, sourceHandle: outgoing }, [...nodes, inserted], remaining);
  if (!verdict.ok || (verdict.sourceHandle && AUXILIARY_HANDLES.has(verdict.sourceHandle))) return null;

  const hub = isHubType(inserted.data.nodeType);
  const targetSize = sizeOf(target);
  const targetCentreY = target.position.y + targetSize.height / 2;
  const left = Math.max(target.position.x, source.position.x + sizeOf(source).width + INSERT_GAP_X);
  // An agent keeps room for its rings: its card sits in the middle of them.
  const position = hub
    ? { x: Math.round(left + NEW_HUB_REACH - ORBIT.hubSize / 2), y: Math.round(targetCentreY - ORBIT.hubSize / 2) }
    : { x: Math.round(left), y: Math.round(targetCentreY - ORBIT.cardHeight / 2) };
  const right = hub ? position.x + ORBIT.hubSize / 2 + NEW_HUB_REACH : position.x + ORBIT.cardWidth;
  const targetLeft = isHubType(target.data.nodeType) ? target.position.x + ORBIT.hubSize / 2 - NEW_HUB_REACH : target.position.x;
  const shift = Math.max(0, Math.round(right + INSERT_GAP_X - targetLeft));
  const moved: Record<string, Point> = {};
  if (shift > 0) {
    for (const id of downstreamOf(target.id, remaining)) {
      const node = nodes.find((candidate) => candidate.id === id);
      if (node && id !== source.id) moved[id] = { x: node.position.x + shift, y: node.position.y };
    }
  }

  const plan: SplicePlan = { replaced, outgoingHandle: verdict.sourceHandle, position, moved };
  const template = target.data.config?.responseTemplate;
  if (hub && target.data.nodeType === "output" && typeof template === "string" && readsTrigger(template, source)) {
    plan.outputTemplate = "{{answer}}";
  }
  return plan;
}
