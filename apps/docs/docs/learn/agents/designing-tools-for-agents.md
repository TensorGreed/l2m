---
title: "Designing tools for agents: names, schemas, errors"
sidebarTitle: "Designing tools for agents"
description: "A model picks a tool from its name, description and schema alone. How to write tool definitions agents use well: one job each, typed inputs, safe retries."
level: intermediate
about: mcp-tool
related: [mcp-tool, tool-calling, write-tool, tool-annotations, idempotency, structured-tool-output]
---

# Designing tools for agents

A model chooses a tool from three things: its name, its description and its input schema. It never sees the code. So a tool definition is documentation written for the model, and a vague one gets called at the wrong time, with the wrong arguments. Four habits fix most of it: give each tool one job, keep reads apart from writes, make writes safe to repeat, and return errors the model can act on.

## What the model sees

When an agent starts, the runtime sends the model a list of definitions. For an <Term id="mcp-tool">MCP tool</Term> that is the `name`, the `description` and the `inputSchema` (a JSON Schema) from the server's `tools/list` answer. The model reads them on every call of the [agent loop](/learn/agents/agent-loop-in-code) and decides whether to call one, which one, and with what arguments.

Nothing else reaches it. Not the tool's source, not its README, not the comment above the function that says "never call this with an empty filter". If the model needs to know it, it goes in the definition.

## A hard tool and a good one

Here is a tool that is hard to use well:

```json
{
  "name": "orders",
  "description": "Handles orders.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "action": { "type": "string" },
      "data": { "type": "string" }
    }
  }
}
```

The name says little. The description says nothing about when to use it or what it returns. The input is free text, and one tool does several jobs, picked by an `action` field the model must guess the values of. Is it `get`, `lookup` or `read`? Is `data` an id or a JSON string?

Here is one of those jobs, done well:

```json
{
  "name": "get_order",
  "description": "Look up one order by its id. Use it before answering any question about an order. Returns status, items and tracking number.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "order_id": {
        "type": "string",
        "pattern": "^A-[0-9]{4}$",
        "description": "The order id, like A-1001"
      }
    },
    "required": ["order_id"],
    "additionalProperties": false
  }
}
```

- **The name is a verb and a noun.** `get_order` says what it does, and it reads clearly next to `refund_order` in a trace.
- **The description answers three questions**: what it does, when to use it, and what it returns. The first words matter most; some runtimes shorten long descriptions.
- **The input is typed.** One required argument, a pattern for a valid id, and an example in plain words. The model has much less room to guess, and a server that checks the schema can refuse a bad call before it does anything.

## Habit 1: one job per tool

Prefer small, focused tools. `get_order`, `list_orders` and `refund_order` are easy to tell apart, for the model and for you. An `orders` tool with an `action` field hides three tools behind one name, and everything you do per tool becomes harder:

- You cannot allow the lookup and require approval for the refund, because they are the same tool.
- A trace that says "called `orders`" tells you nothing until you read the arguments.
- Usage counts per tool are meaningless.

Small does not mean tiny. A tool should match one thing a person would ask for. If every task needs `get_customer` followed by `get_customer_address`, one `get_customer` that returns the address is better: fewer steps, fewer tokens, fewer chances to stop halfway.

Fewer, sharper tools also help the model choose. Each definition is sent on every model call, and a long list of overlapping tools leads to wrong picks ([too many tools](/learn/agents/too-many-tools)).

## Habit 2: keep reads apart from writes

A read fetches. A <Term id="write-tool">write tool</Term> changes something: it sends, creates, updates, deletes, pays or deploys. Keep them in separate tools, and say which is which.

A read can run freely. A write is the tool you will want to approve, limit and log. If a tool both reads and writes depending on an argument, every call has to be treated as a write, and the reads get slowed down by approvals they never needed.

MCP lets a server describe this with <Term id="tool-annotations">tool annotations</Term>: `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint`. Set them honestly on servers you write. On servers you call, remember the spec's own warning that clients must treat them as untrusted unless the server is trusted, and classify tools yourself ([tool annotations](/learn/mcp/tool-annotations)).

## Habit 3: make writes safe to repeat

Models retry. Networks drop replies. A client that never got an answer cannot tell whether the call failed before or after it took effect. If it sends the call again, a refund can happen twice.

Design writes so that a repeat is harmless:

- **Accept an idempotency key.** The caller sends a unique key with the request. The tool remembers the keys it has seen, and a repeated key returns the first result instead of acting again. See <Term id="idempotency">idempotency</Term>.
- **Prefer "set" to "add".** `set_status(order, "shipped")` is safe to repeat; `increment_counter` is not.
- **Check before acting.** A refund tool can refuse a second refund for the same order and say so.

Once a write is idempotent, say so: `idempotentHint: true` tells a client it may send the call again after a timeout.

## Habit 4: return errors the model can act on

The model reads every tool result, errors included. "Failed" teaches it nothing. "No order with id A-10001. Order ids are A followed by four digits, like A-1001." lets it fix its next call.

A useful error says:

- **what was wrong**, naming the argument;
- **what a valid value looks like**, or which tool to call first;
- **whether retrying can help.** "Rate limited, try again in 30 seconds" and "Permission denied" call for different next steps.

MCP separates two kinds of failure. A protocol error (an unknown tool, a malformed request) is a JSON-RPC error for the client. A tool that ran and failed answers a normal result with `isError: true` and a message in its content, so the model sees it. Business errors belong in the second kind.

Keep results small too. A tool that returns a whole table puts all of it into every later model call of the run. Return the fields the task needs, and offer a way to ask for more. When the shape matters, add an `outputSchema` and return <Term id="structured-tool-output">structured output</Term>.

## A checklist for one tool

- The name is a verb and a noun, unique among the agent's tools.
- The description says what it does, when to use it and what it returns, with the key words first.
- Every argument has a type and a description; required arguments are marked; formats come with an example.
- It does one job. It reads or it writes, not both.
- A write is safe to repeat, and says so.
- Errors name the problem and the fix.
- Results hold what the task needs and no more.

## Designing tools for L2M agents

In L2M, an agent's tools come from MCP Tool nodes (tools from an MCP server) and [Workflow Tool](/runtime/workflow-tool) nodes (another workflow as one tool) on its `tool` port. A few things the runtime does shape how you write definitions:

- **Definitions are compacted before the model sees them.** A tool's description is cut to 280 characters. Each input schema keeps at most 8 top-level arguments, and for each one only its type, a description cut to 120 characters, whether it is required, and up to 10 enum values. Keywords such as `pattern`, `format` and `additionalProperties`, and the inner structure of nested objects, are not sent. So put the format in the argument's description too ("The order id, like A-1001"), keep arguments flat and few, and lead the tool's description with what matters. Your server still receives the call and can check it against the full schema.
- **Missing required arguments come back as an error the model can fix.** Before calling the server, the runtime checks that every required argument is there; if not, the model gets a result naming the missing ones and asking it to call again. A call to a tool that does not exist gets the list of tools that do.
- **Reads and writes are classified per tool.** An admin can mark a tool read-only or write on the MCP server's Tools table, and that mark wins over the server's `readOnlyHint`. A tool with neither counts as a write tool ([read-only classification](/product/mcp-tool-policy#read-only-classification)). Optional features build on it: approval before write tools, and the **No write tools** switch.
- **Only safe tools are sent again.** When a connection breaks before an answer arrives, the MCP client sends the call again only for a tool that is read-only or idempotent, by an admin's mark or the server's `readOnlyHint` or `idempotentHint`. Any other call fails as `outcome_unknown` instead of risking a second write ([the safe re-send rule](/product/mcp-2026-07-28#the-safe-re-send-rule)).
- **Workflow tools take their definition from the child workflow.** An Expose as MCP Tool trigger gives the name, description and input schema; the node's **Tool name** and **Description for the model** override them, and the panel previews what the agent will see.
- **Changes are visible.** The [MCP server registry](/product/mcp-server-registry) keeps a history of each server's tool schemas and flags changes that could break callers, so a rewritten description does not slip in unnoticed.

## Further reading

- [MCP specification 2025-11-25: Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) (modelcontextprotocol.io): tool definitions, annotations, `isError` and output schemas
- [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) (Anthropic engineering): Appendix 2, "Prompt engineering your tools"
- [Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) (Anthropic engineering)
- Related guides: [Too many tools](/learn/agents/too-many-tools), [Tool annotations](/learn/mcp/tool-annotations), [Testing MCP tool calls](/learn/testing/testing-mcp-tools), [Build a minimal MCP server](/learn/mcp-servers/build-a-minimal-mcp-server)
- Errors: [Model won't call tools](/learn/troubleshooting/model-does-not-call-tools), [Invalid params (-32602)](/learn/troubleshooting/json-rpc-32602-invalid-params)
