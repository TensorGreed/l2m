/**
 * The fields of a node's run output that a `{{ }}` template filled with nothing (an empty string, or null for a
 * single `{{ }}` of type Auto): a Set field or an Output response
 * whose template read a value the run did not have. Runs go on (unless strict templates are on), so the run data
 * marks them instead of leaving an empty string to look like a result.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const HAS_TEMPLATE = /\{\{[\s\S]*?\}\}/;

/** Empty as a template leaves it: "" as text, or no value (null) where a single `{{ }}` keeps its type. */
const isEmpty = (value: unknown) => value === "" || value === null || value === undefined;

function readPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const part of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

/** The output keys of a Set or Output node that rendered empty from a template (none for other nodes). */
export function renderedEmptyFields(nodeType: string, config: Record<string, unknown> | undefined, output: unknown): string[] {
  if (!config || !isRecord(output)) return [];
  if (nodeType === "set_node") {
    const assignments = Array.isArray(config.assignments) ? config.assignments.filter(isRecord) : [];
    const empty: string[] = [];
    for (const assignment of assignments) {
      const key = typeof assignment.key === "string" ? assignment.key.trim() : "";
      const template = typeof assignment.valueTemplate === "string" ? assignment.valueTemplate : "";
      if (!key || !HAS_TEMPLATE.test(template)) continue;
      const value = key in output ? output[key] : readPath(output, key);
      if (isEmpty(value) && !empty.includes(key)) empty.push(key);
    }
    return empty;
  }
  if (nodeType === "output") {
    const template = typeof config.responseTemplate === "string" ? config.responseTemplate : "";
    const key = typeof config.outputKey === "string" && config.outputKey ? config.outputKey : "result";
    return HAS_TEMPLATE.test(template) && key in output && isEmpty(output[key]) ? [key] : [];
  }
  return [];
}
