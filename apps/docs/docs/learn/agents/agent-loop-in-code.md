---
title: "An AI agent loop in about 30 lines of code"
sidebarTitle: "The agent loop in code"
description: "Write the tool-calling loop yourself: messages, tool definitions, a model call, tool results and a step limit, in plain JavaScript with no key or network."
level: beginner
about: agent-loop
related: [agent-loop, tool-calling, max-iterations, ai-agent, mcp-tool]
---

# An AI agent loop in about 30 lines of code

An <Term id="agent-loop">agent loop</Term> needs four things: a list of messages, the tool definitions, a function that calls the model, and the tools themselves. Each step sends the whole conversation to the model; if the reply asks for tools, run them, add each result as a message and go round again; if it asks for none, that reply is the answer. A step limit stops a model that never finishes. Everything else an agent runtime does, such as memory, approvals and budgets, hooks into one of those steps.

## The four parts

- **Messages.** A list with a role and some content on each entry: `system`, `user`, `assistant` and `tool`. An assistant message that wants tools also carries <Term id="tool-calling">tool calls</Term>: an id, a tool name and the arguments. A tool message carries the id of the call it answers.
- **Tool definitions.** For each tool, a name, a description and a JSON Schema for its input. This is all the model ever sees of a tool. It never sees the code that runs it.
- **A model call.** One function that takes the messages and the definitions and returns the model's next message. Any provider can sit behind it, and so can a fake model for tests.
- **The tools.** The functions that do the work: call an API, read a database, look up an order.

## The loop

This is the whole loop. `callModel` is the only part that talks to a model.

```js
async function runAgent(callModel, tools, task, maxSteps = 6) {
  const messages = [
    { role: "system", content: "Answer the user. Use a tool when you need facts." },
    { role: "user", content: task },
  ];
  const defs = tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));

  for (let step = 1; step <= maxSteps; step++) {
    const reply = await callModel({ messages, tools: defs });
    messages.push(reply);
    if (!reply.toolCalls?.length) return { answer: reply.content, messages };

    for (const call of reply.toolCalls) {
      console.log(`step ${step}: run ${call.name} ${JSON.stringify(call.args)}`);
      const tool = tools.find((t) => t.name === call.name);
      const result = tool
        ? await tool.run(call.args).catch((e) => ({ error: String(e?.message ?? e) }))
        : { error: `unknown tool: ${call.name}` };
      messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(result) });
    }
  }
  throw new Error(`stopped: no final answer after ${maxSteps} steps`);
}
```

Line by line, the decisions that matter:

1. **The conversation starts with two messages**: a system prompt and the user's task.
2. **The definitions are built once**, from each tool's name, description and input schema. The `run` function stays behind.
3. **Every step sends everything.** The model has no memory between calls; the `messages` list is everything it knows about this run. This is also why each step costs more than the last ([controlling LLM costs](/learn/operations/llm-cost-control)).
4. **No tool calls means done.** A reply with text and no tool calls is the final answer.
5. **A reply can ask for zero, one or several tools.** The loop runs them in order and adds every result before it calls the model again.
6. **Failures become results.** A tool that throws, or a name the model made up, turns into an `{ error }` result. The model reads it and can try something else. Crashing the loop instead would throw away the whole run over one bad call.
7. **Each result is tied to its call** by `toolCallId`. Provider APIs reject a conversation where a tool result has no matching call.
8. **The step limit is the last line of defence.** Without it, a confused model can call tools forever, and every call costs money. <Term id="max-iterations">Max iterations</Term> is the same idea under another name.

## Run it with no key

Save the file below as `agent.mjs` and run `node agent.mjs` with Node.js 20 or later. It has the loop above, two tools with in-memory data and a fake model that decides with fixed rules, so it needs no API key, no package and no network.

```js
// agent.mjs: a complete agent loop with a fake model and two fake tools. Run: node agent.mjs [--stuck]

// 1. The tools. The model only ever sees name, description and inputSchema, never run().
const ORDERS = { "A-1001": { item: "headphones", status: "shipped", tracking: "TRK-7731" } };
const SHIPMENTS = { "TRK-7731": { carrier: "Example Post", eta: "Thursday" } };
const tools = [
  {
    name: "get_order",
    description: "Look up one order by id. Returns item, status and tracking number.",
    inputSchema: { type: "object", properties: { order_id: { type: "string" } }, required: ["order_id"] },
    run: async ({ order_id }) => ORDERS[order_id] ?? { error: `no order ${order_id}; ids look like A-1001` },
  },
  {
    name: "track_shipment",
    description: "Look up a shipment by tracking number. Returns carrier and expected delivery day.",
    inputSchema: { type: "object", properties: { tracking: { type: "string" } }, required: ["tracking"] },
    run: async ({ tracking }) => SHIPMENTS[tracking] ?? { error: `no shipment ${tracking}` },
  },
];

// 2. The loop.
async function runAgent(callModel, tools, task, maxSteps = 6) {
  const messages = [
    { role: "system", content: "Answer the user. Use a tool when you need facts." },
    { role: "user", content: task },
  ];
  const defs = tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));

  for (let step = 1; step <= maxSteps; step++) {
    const reply = await callModel({ messages, tools: defs });
    messages.push(reply);
    if (!reply.toolCalls?.length) return { answer: reply.content, messages };

    for (const call of reply.toolCalls) {
      console.log(`step ${step}: run ${call.name} ${JSON.stringify(call.args)}`);
      const tool = tools.find((t) => t.name === call.name);
      const result = tool
        ? await tool.run(call.args).catch((e) => ({ error: String(e?.message ?? e) }))
        : { error: `unknown tool: ${call.name}` };
      messages.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(result) });
    }
  }
  throw new Error(`stopped: no final answer after ${maxSteps} steps`);
}

// 3. A fake model that follows fixed rules, so this runs with no key and no network.
const lastResult = (messages) => JSON.parse(messages.findLast((m) => m.role === "tool").content);
async function fakeModel({ messages }) {
  const done = messages.filter((m) => m.role === "tool").length;
  if (done === 0) {
    const order_id = messages[1].content.match(/A-\d{4}/)?.[0] ?? "unknown";
    return { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "get_order", args: { order_id } }] };
  }
  if (done === 1) {
    const order = lastResult(messages);
    if (order.error) return { role: "assistant", content: `Sorry, I could not find that order (${order.error}).` };
    return { role: "assistant", content: "", toolCalls: [{ id: "call_2", name: "track_shipment", args: { tracking: order.tracking } }] };
  }
  const ship = lastResult(messages);
  return { role: "assistant", content: `Your order has shipped with ${ship.carrier} and should arrive ${ship.eta}.` };
}
let n = 0;
const stuckModel = async () => ({ role: "assistant", content: "", toolCalls: [{ id: `call_${++n}`, name: "get_order", args: { order_id: "A-1001" } }] });

// 4. Run it.
const model = process.argv.includes("--stuck") ? stuckModel : fakeModel;
try {
  const { answer, messages } = await runAgent(model, tools, "Where is my order A-1001?");
  console.log(`answer: ${answer}`);
  console.log(`messages: ${messages.map((m) => m.role).join(", ")}`);
} catch (e) {
  console.log(e.message);
}
```

The output:

```text
step 1: run get_order {"order_id":"A-1001"}
step 2: run track_shipment {"tracking":"TRK-7731"}
answer: Your order has shipped with Example Post and should arrive Thursday.
messages: system, user, assistant, tool, assistant, tool, assistant
```

Read the last line. The model asked for `get_order`, read the tracking number from its result, asked for `track_shipment` with it, then answered. Seven messages, three model calls, two tool calls. That list is the whole run.

Now run `node agent.mjs --stuck`. The stuck model asks for `get_order` on every step and never answers. The loop runs it six times and stops with `stopped: no final answer after 6 steps`. That is the step limit doing its job.

Three experiments worth a minute each:

- **Lower the limit.** Call `runAgent(model, tools, task, 2)` with the normal model. The loop stops one step before the answer. A limit that is too low fails real tasks; pick it from the task.
- **Ask about an order that does not exist.** Change the task to `A-9999`. The tool returns an error that says what ids look like, and the fake model passes it on. A real model would often fix its next call from that hint.
- **Put a real model behind `callModel`.** Map `messages` and `defs` to your provider's chat API, and map its tool calls back to `{ id, name, args }`. The loop itself does not change.

## What a production runtime adds

The loop above is correct, and it is also the smallest thing that works. Each production feature hooks into one of its lines:

| Concern | Where it hooks in |
|---|---|
| Memory across turns | Load earlier messages before the first call; save the new ones at the end ([agent memory](/learn/agents/agent-memory)) |
| Fewer, better tools | Build `defs` from a short list, not every tool you have ([too many tools](/learn/agents/too-many-tools)) |
| Tool design | What `name`, `description`, `inputSchema` and error results say ([designing tools for agents](/learn/agents/designing-tools-for-agents)) |
| Approvals | Before `tool.run` for a tool that changes something, pause and wait for a person ([human in the loop](/learn/agents/human-in-the-loop)) |
| Rules | Before `tool.run`, check the call against allow and deny rules ([least privilege](/learn/security/least-privilege-for-agents)) |
| Budgets | Before `callModel`, check spend; after it, add the tokens used ([cost control](/learn/operations/llm-cost-control)) |
| Large results | Trim `result` before it goes into `messages`, or it is paid for on every later step |
| Tracing | Record each model call and tool call with its inputs, outputs and timing |
| Tests | Swap in a fake `callModel` and recorded tool answers, as this page does ([regression testing](/learn/testing/regression-testing-agents)) |
| Many agents | Make one tool's `run` start another agent loop ([supervisor and workers](/learn/agents/supervisor-and-workers)) |

The last row is worth a second look. A worker agent is just a tool whose `run` calls `runAgent` with its own model, tools and task. The supervisor's loop does not change at all.

## The same loop in L2M

In L2M, the **Agent Orchestrator** node runs this loop, with its model on the `chat_model` port and its tools on the `tool` port. The runtime makes the same choices as the code above, and a few more:

- Tool calls from one reply run in order, and every result is added before the next model call.
- A tool that fails, a call to a tool that does not exist, and a call missing a required argument all come back to the model as an error result, not a crashed run. The error for an unknown tool lists the tools that do exist; the one for missing arguments names them.
- `maxIterations` on the node is the step limit. New Agent Orchestrator nodes start at 6. When it runs out, the run ends with the model's last text, or "Agent stopped after reaching iteration limit."; it does not throw.
- An empty reply while steps remain is not accepted as an answer: the runtime asks the model to answer or call a tool.
- Every step, model call and tool call shows on the run's trace.

[What is an AI agent?](/learn/agents/what-is-an-ai-agent) walks through the same loop in L2M, and the [agent loop reference](/runtime/agent-loop) has the details. To run an agent without a key, follow the [zero-key MCP agent recipe](/recipes/zero-key-mcp-agent).

## Further reading

- [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) (Anthropic engineering): the augmented model, loops and stopping conditions
- [MCP specification 2025-11-25: Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) (modelcontextprotocol.io): what a tool definition holds
- Related guides: [What is an AI agent?](/learn/agents/what-is-an-ai-agent), [MCP vs function calling](/learn/mcp/mcp-vs-function-calling), [Agent stuck in a tool loop](/learn/troubleshooting/agent-stuck-in-tool-loop)
- In L2M: [Agent loop](/runtime/agent-loop), [Build your first MCP agent](/getting-started/build-your-first-mcp-agent)
