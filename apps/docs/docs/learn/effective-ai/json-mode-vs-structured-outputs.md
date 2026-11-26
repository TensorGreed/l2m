---
title: "JSON mode vs structured outputs: what each guarantees"
sidebarTitle: "JSON mode vs structured outputs"
description: "JSON mode promises valid JSON; structured outputs constrain the reply to your JSON Schema. What each provider guarantees, and why you still validate."
level: intermediate
about: structured-output
related: [structured-output, structured-tool-output, tool-calling, few-shot-prompting, openai-compatible-api]
---

# JSON mode vs structured outputs

JSON mode makes a model return valid JSON, with no promise about its shape: fields can be missing, misnamed or of the wrong type. <Term id="structured-output">Structured outputs</Term> go further and constrain the reply to a JSON Schema you supply, so the fields and types match it. Where a provider offers structured outputs, use them. Still validate every reply in your own code: the guarantee has documented exceptions, such as refusals and cut-off replies, and a schema cannot tell whether the values are right.

## Two features, two guarantees

**JSON mode** is the older feature. On OpenAI's Chat Completions API it is `response_format: { "type": "json_object" }`, which, in the words of the [API reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), "ensures the message the model generates is valid JSON". The Structured Outputs guide is explicit about the limit: "JSON mode will not guarantee the output matches any specific schema, only that it is valid and parses without errors." It also has rules of its own: you must tell the model to produce JSON in a message, and the API returns an error if the string "JSON" does not appear somewhere in the context ([OpenAI Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs#json-mode)).

**Structured outputs** take a schema. On the same API it is `response_format: { "type": "json_schema", "json_schema": { ... } }`. The guide says it "constrains completed, non-refusal model output to your supplied JSON Schema", calls it "the evolution of JSON mode", and recommends "always using Structured Outputs instead of JSON mode when possible".

Other providers have their own versions:

- **Anthropic** puts the schema in `output_config.format` with `type: "json_schema"`. Its docs say structured outputs "guarantee schema-compliant responses through constrained decoding": no JSON parsing errors, and guaranteed field types and required fields. The same mechanism covers tool inputs, with `strict: true` on a tool definition ([Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)).
- **Google Gemini** can be configured "to generate responses that adhere to a provided JSON Schema". Its best practices add: "While output is syntactically correct JSON, always validate values in your application", and plan for "schema-compliant but semantically incorrect outputs" ([Gemini structured outputs](https://aistudio.google.com/docs/structured-output)). The `generateContent` API also has a plain JSON setting, `responseMimeType: "application/json"` ([GenerationConfig](https://aistudio.google.com/api-reference/generate-content)).

## Side by side

| | JSON mode | Structured outputs |
|---|---|---|
| What you send | A flag asking for JSON | A JSON Schema |
| Valid JSON | Yes, if the reply completes | Yes, if the reply completes |
| Required fields present, right types | No promise | Yes, within the provider's supported schema subset |
| Enum values respected | No promise | Yes, with documented exceptions |
| Values correct | No | No |
| Schema features | Not applicable | A subset of JSON Schema, which differs by provider |
| Still need your own validation | Yes, for the shape and the values | Yes, for the exceptions and the values |

## Where the guarantee stops

Provider docs list the cases where a structured reply may not match the schema. Handle each one in code:

- **Refusals.** OpenAI: "a refusal does not necessarily follow the schema you have supplied", and the response carries a separate `refusal` field. Anthropic: a refusal has `stop_reason: "refusal"` and "the output might not match your schema because the refusal message takes precedence over schema constraints".
- **Cut-off replies.** A reply that hits the token limit is incomplete. Anthropic says the output "might be incomplete and not match your schema" when `stop_reason` is `max_tokens`; OpenAI's guide says your application must handle edge cases where the output is not a complete JSON object.
- **Enum casing.** Anthropic's docs say structured outputs "don't guarantee the capitalization of string `enum` and `const` values", and advise comparing enum values case-insensitively.
- **Unsupported schema features.** Each provider supports a subset of JSON Schema. Anthropic, for example, lists recursive schemas, numeric constraints such as `minimum`, and string length constraints among the unsupported features, and returns a 400 error if you use one. OpenAI requires every field to be listed in `required` and `additionalProperties: false` on every object.
- **Wrong values.** A schema says a `priority` is an integer. It cannot say it is the right integer. OpenAI's guide notes that your application must still "validate any business rules that the schema does not express".

Without a schema at all, in JSON mode or plain text, all of these and more are your code's job. OpenAI's guide puts it plainly: if you cannot use Structured Outputs, "use a validation library and potentially retries".

## Validate and retry in code

This script checks a reply against a small schema, and if it does not match, sends the reply back with the exact errors and asks once more. The validator covers a small subset of JSON Schema (`type`, `enum`, `properties`, `required`, `additionalProperties: false` and `items`), enough for flat records. For larger schemas, use a full JSON Schema library.

The model is a stub that returns two fixed replies, so the script runs without a key or network. The first reply is the kind JSON mode allows: valid JSON in the wrong shape. It is not a recording of any real model.

```js
// validate.mjs: check a model's JSON reply against a small schema, retry once with the error.
// Run: node validate.mjs
// The stub model returns fixed replies so the script runs offline. It is not a real model's behaviour.

const SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string", enum: ["billing", "bug", "account", "other"] },
    priority: { type: "integer" },
    summary: { type: "string" },
  },
  required: ["category", "priority", "summary"],
  additionalProperties: false,
};

// A validator for a small subset of JSON Schema: type, enum, properties, required,
// additionalProperties: false and items. Enough for flat records; use a full library for more.
function validate(value, schema, path = "$") {
  const errors = [];
  const typeOf = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : Number.isInteger(v) ? "integer" : typeof v);
  const actual = typeOf(value);
  if (schema.type && !(schema.type === actual || (schema.type === "number" && actual === "integer"))) {
    return [`${path}: expected ${schema.type}, got ${actual}`];
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} is not one of ${schema.enum.join(", ")}`);
  if (actual === "object") {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${path}: missing required "${key}"`);
    for (const [key, v] of Object.entries(value)) {
      if (schema.properties?.[key]) errors.push(...validate(v, schema.properties[key], `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected property "${key}"`);
    }
  }
  if (actual === "array" && schema.items) value.forEach((v, i) => errors.push(...validate(v, schema.items, `${path}[${i}]`)));
  return errors;
}

function check(text) {
  let value;
  try { value = JSON.parse(text); } catch (e) { return { ok: false, errors: [`not valid JSON: ${e.message}`] }; }
  const errors = validate(value, SCHEMA);
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

// Stub replies: valid JSON with the wrong shape first, then a corrected reply.
const REPLIES = [
  '{"category": "Billing", "priority": "high", "summary": "Charged twice for March"}',
  '{"category": "billing", "priority": 2, "summary": "Charged twice for March"}',
];
let call = 0;
const stubModel = async (messages) => REPLIES[Math.min(call++, REPLIES.length - 1)];

async function extract(ticket) {
  const messages = [
    { role: "system", content: `Return only JSON matching this schema: ${JSON.stringify(SCHEMA)}` },
    { role: "user", content: ticket },
  ];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const reply = await stubModel(messages);
    const result = check(reply);
    console.log(`attempt ${attempt}: ${result.ok ? "valid" : "invalid"}`);
    if (result.ok) return result.value;
    result.errors.forEach((e) => console.log(`  ${e}`));
    // Retry once: show the model its reply and exactly what was wrong.
    messages.push({ role: "assistant", content: reply });
    messages.push({ role: "user", content: `That reply did not match the schema:\n${result.errors.join("\n")}\nReturn corrected JSON only.` });
  }
  throw new Error("no valid reply after one retry");
}

console.log(await extract("I was charged twice for March, please fix it."));

// Cut-off output (for example at a token limit) is not valid JSON at all.
console.log(check('{"category": "billing", "priority": 2, "summ').errors[0]);
```

Running `node validate.mjs` with Node.js 24 prints:

```text
attempt 1: invalid
  $.category: "Billing" is not one of billing, bug, account, other
  $.priority: expected integer, got string
attempt 2: valid
{
  category: 'billing',
  priority: 2,
  summary: 'Charged twice for March'
}
not valid JSON: Unterminated string in JSON at position 44 (line 1 column 45)
```

What it shows:

- **The first reply parses.** `JSON.parse` succeeds, and a JSON-mode check would pass it. Only the schema check finds the capitalised label and the string priority.
- **The retry carries the errors**, not just "try again". The model gets its own reply and the exact paths that failed, which gives it something specific to fix.
- **One retry, then stop.** A loop without a limit turns one bad input into unbounded cost. After the retry, fail the item and send it somewhere a person can look.
- **The last line is a cut-off reply.** No schema setting prevents it; check the stop reason and the parse.

With structured outputs turned on, the first reply in this script should not happen. The validator stays, for the refusals, cut-off replies and enum casing above, and for the business rules no schema expresses: whether a refund amount is below the order total, or whether the order id exists.

## Which to use when

- **Use structured outputs** when the provider and model support them and your schema fits their subset. It removes most shape errors before they reach your code.
- **Use tool calling with a strict schema** when the JSON is really an action's arguments. Strict tool use applies the same constraint to tool inputs on providers that offer it ([tool calling](/glossary/tool-calling)).
- **Use JSON mode** only where structured outputs are not available, and validate the shape yourself.
- **With neither**, ask for JSON in the prompt, show one or two examples of the exact shape ([zero-shot vs few-shot prompting](/learn/effective-ai/zero-shot-vs-few-shot-prompting)), and validate and retry as above.
- **In every case**, check the stop reason, parse, validate against the schema, then check the values against your own rules. Keep the schema small and flat: it is easier for the model to follow and for you to validate.

## In L2M

L2M has two places where this applies:

- **The Output Parser node** (`output_parser`) validates a model's answer after an LLM Call node. In `json_schema` mode it parses the answer, then checks required fields, the type of string, number and boolean fields, and enum values against a schema you give in the node. If the check fails and the upstream model is known, it asks that model again with the error, the schema and the original output, up to `maxRetries` times (default 2). If it still fails, the node fails, or with `parsingMode: anything_goes` it returns `parsed: null` and a warning. The sample workflow `structured-output-flow.json` wires a System Prompt and a Text Input into an LLM Call, then an Output Parser and an Output ([utility node reference](/nodes/reference/utility)).
- **The `/v1` AI gateway** accepts `response_format` with `text`, `json_object` or `json_schema` on `POST /v1/chat/completions` and passes it to the route's provider: as `response_format` to OpenAI-compatible providers, and as a JSON response type with the schema to Gemini. A route whose provider adapter does not support it, such as Anthropic in the current adapter, answers `400` with `unsupported_parameter` rather than dropping the field silently ([/v1 AI gateway](/product/ai-gateway)).

## Further reading

- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) (OpenAI API docs): Structured Outputs vs JSON mode, supported schemas, refusals
- [Create chat completion: response_format](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) (OpenAI API reference)
- [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) (Claude Docs): JSON outputs, strict tool use, invalid outputs
- [Structured outputs](https://aistudio.google.com/docs/structured-output) (Gemini API docs)
- [JSON Schema](https://json-schema.org/) (json-schema.org)
- Related guides: [Zero-shot vs few-shot prompting](/learn/effective-ai/zero-shot-vs-few-shot-prompting), [Email to structured data](/learn/use-cases/email-to-structured-data), [MCP vs function calling](/learn/mcp/mcp-vs-function-calling), [Designing tools for agents](/learn/agents/designing-tools-for-agents)
