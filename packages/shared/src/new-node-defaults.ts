/**
 * The settings a NEW node starts with, wherever it is created (the editor's palette, Describe it). It is the node
 * catalog's sample config with two kinds of change; a saved node keeps what it has:
 *
 * - Fields the person has to fill start empty instead of holding example values that look like real config (an example
 *   URL, three sample Set rows, a `status = active` condition, a `documents` loop key). The editor shows the examples
 *   as grey placeholders, and the catalog keeps them as examples.
 * - A Schedule Trigger starts switched off, so a new workflow never fires on its own before the person turns it on.
 */

/** Values that replace the sample's for a new node (each is what the node needs before it does anything). */
const BLANK_FIELDS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  http_request: { urlTemplate: "" },
  set_node: { assignments: [{ key: "", valueTemplate: "", type: "auto" }] },
  filter_node: { conditions: [{ field: "", operator: "eq", value: "" }] },
  loop_node: { inputKey: "" },
  // The tool's name, description and input are the person's to describe; the catalog's knowledge-base example stays a
  // placeholder. An empty input schema takes no arguments until fields are added.
  mcp_server_trigger: { toolName: "", toolDescription: "", inputSchema: { type: "object", properties: {} } },
  // The agent's description and the remote card URL are the person's to give.
  a2a_trigger: { agentDescription: "" },
  a2a_agent: { cardUrl: "" },
  human_approval: { approvalMessage: "" },
  user_prompt: { text: "" },
  // The field and group-by names, the switch value and its cases, the model server and the Slack webhook are the
  // person's: the catalog's `amount`/`region`, `{{sentiment}}` cases, `localhost:1234` and `T000/XXX` are examples.
  summarize_node: { fieldsToSummarize: [{ field: "", aggregation: "sum" }], fieldsToGroupBy: [] },
  switch_node: { switchValue: "", cases: [] },
  openai_compatible_chat_model: { baseUrl: "", model: "" },
  slack_send_message: { webhookUrl: "" }
};

/** Sample keys a new node leaves out: they only matter once another setting asks for them. */
const DROPPED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  // The combine key matters only in "Combine by Key" mode, where its field shows `id` as a placeholder.
  merge_node: ["combineKey"]
};

/** A new node's base config: the sample with example values blanked and a schedule switched off. Never changes the sample. */
export function newNodeBaseConfig(nodeType: string, sampleConfig: Record<string, unknown> | undefined): Record<string, unknown> {
  const config: Record<string, unknown> = { ...structuredClone(sampleConfig ?? {}), ...structuredClone(BLANK_FIELDS[nodeType] ?? {}) };
  for (const key of DROPPED_FIELDS[nodeType] ?? []) delete config[key];
  if (nodeType === "schedule_trigger") config.active = false;
  return config;
}

/** Whether `zone` is an IANA time zone this runtime knows. */
export function isKnownTimeZone(zone: string): boolean {
  if (!zone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether `value` is an example address from the node catalog rather than a real one: an `example.com`/`.org`/`.net`
 * host or mail domain (and their subdomains), or Slack's documented `T000/B000/XXX` webhook. A run would call it and
 * fail confusingly, so a described draft leaves it empty and lists the node as unfinished.
 */
export function isPlaceholderAddress(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return false;
  if (/hooks\.slack\.com\/services\/T0+\/B0+\/X+/i.test(text)) return true;
  if (/^[^\s@]+@(?:[a-z0-9-]+\.)*example\.(?:com|org|net)$/i.test(text)) return true;
  const host = /^(?:[a-z][a-z0-9+.-]*:\/\/)?([^\s/:?#@]+)(?=[:/?#]|$)/i.exec(text)?.[1] ?? "";
  return /(?:^|\.)example\.(?:com|org|net)$/i.test(host);
}
