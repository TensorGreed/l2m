---
title: "Remote agents over A2A: publish and call them safely"
sidebarTitle: "Remote agents over A2A"
description: "How to publish an agent for other agents to call, and how to call one you cannot inspect: tokens, untrusted input, approvals, timeouts and replays."
level: intermediate
about: worker-agent
related: [worker-agent, supervisor-agent, write-tool, human-in-the-loop, budget, ssrf]
---

# Remote agents over A2A

A2A, the Agent2Agent protocol, lets one agent hand a task to another agent that runs somewhere else. Publishing one takes two parts: a public Agent Card that says what the agent does and how to authenticate, and an endpoint that turns each message into a task. Calling one safely takes more care, because you cannot see the remote agent's prompt, tools or model. Treat it like a <Term id="write-tool">write tool</Term> you cannot inspect: ask a person before each call unless you know it only reads, send only what the task needs, put a timeout, a budget and outbound rules around it, and never call it from a test replay.

[MCP vs A2A](/learn/mcp/mcp-vs-a2a) covers what each protocol defines and when to use which. This guide is about running A2A in production.

## Why a remote agent is different from your own worker

A <Term id="supervisor-agent">supervisor</Term> and its <Term id="worker-agent">workers</Term> in one system share a runtime. You wrote every worker's prompt, chose its tools and can read its trace ([supervisor and worker agents](/learn/agents/supervisor-and-workers)).

A remote agent belongs to another team or another company. You send it a task in plain language, and something happens somewhere else. It might only look something up. It might refund an order. It may take seconds or hours, ask a question back, or fail. And the answer it sends back was written by a model you do not control.

That changes the rules on both sides:

- **The publisher** is opening an agent, and everything it can reach, to callers on a network.
- **The caller** is giving a task to a black box and reading its answer back into its own agent.

## Publishing an agent

An A2A agent is found through its **Agent Card**: a small JSON document at a well-known address, `/.well-known/agent-card.json`, with the agent's name, its skills, its endpoint and how to authenticate. Callers send messages to a **JSON-RPC endpoint**. Each message becomes a **task**, with a state such as working, input required, completed, failed or canceled. A long task can be streamed, or read again later by its id.

Then decide who may call it:

- **The card is public.** Discovery needs it. Put nothing in it you would not publish: a name, a description of the skill, the endpoint and the auth scheme.
- **The endpoint usually is not.** Ask for a token, unless the agent is harmless to everyone on the network. Give each calling system its own token, so you can tell callers apart and revoke one.
- **Every incoming message is untrusted input.** It is a prompt written by someone else. An instruction hidden in it is a [prompt injection](/learn/security/prompt-injection), aimed at whatever tools your agent holds. Give the published agent only the tools its skill needs.
- **Every task is a run.** It spends your model budget and can call your tools. It needs the same limits, approvals, logs and tests as any other run, not a lighter path because it came from a machine.

Here is a caller in plain code, with no library: read the card, find the endpoint, send a message with a token.

```js
const base = "https://agents.example.com/a2a/order-desk";
const card = await (await fetch(`${base}/.well-known/agent-card.json`)).json();
const endpoint = card.supportedInterfaces?.[0]?.url ?? card.url;   // 1.0 cards list interfaces; 0.3 cards have url

const res = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.ORDER_DESK_TOKEN}` },
  body: JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "SendMessage",
    params: { message: { messageId: crypto.randomUUID(), role: "ROLE_USER", parts: [{ text: "Where is order A-1001?" }] } },
  }),
});
console.log(JSON.stringify(await res.json(), null, 2));   // a task: its id, its state, and the answer as an artifact
```

Without the token, the endpoint should refuse the call. With it, the task comes back completed, with the agent's answer.

## Calling a remote agent

From the caller's side, treat each call like a write you cannot inspect.

**Ask before each call, unless it only reads.** You cannot see what the remote agent will do with the task. If you have not confirmed that it changes nothing, put a [human approval](/learn/agents/human-in-the-loop) in front of each call, showing the exact task text it would send. Mark it read-only only when you know, for example because it is your own read-only agent.

**Send only what the task needs.** The task goes to another system and may be logged there. A supervisor tends to paste the whole conversation into a task; write the worker description so it asks for the specific question instead.

**Treat its answer as outside content.** The answer comes from a model you do not control. It goes into your agent's context like a web page or an email would, and it can carry instructions. Do not let a remote agent's answer, on its own, trigger a write in your system without a check.

**Put limits around it:**

- **A timeout that cancels the remote task.** A task can run for hours. When your time is up, cancel it at the other end too, so it does not keep working, and spending, after you stopped waiting.
- **A budget on the run that calls it.** A supervisor that delegates in a loop calls the remote agent again and again.
- **Outbound rules.** Decide which hosts your agents may reach at all. A card that points the endpoint at another host, or at an internal address, is a classic way to turn a caller into a proxy for <Term id="ssrf">server-side request forgery</Term>.
- **A secret store for the token.** The token belongs in your secrets, not in the workflow or the prompt.

**Never call it from a replay.** A regression test replays a run after a prompt or model change. If that replay called the remote agent again, the test could repeat a refund. Record the remote agent's answer once, and let the replay use the recording, as it does for any write.

## A short checklist

| Publishing an agent | Calling a remote agent |
|---|---|
| Public card, protected endpoint | Approval before each call unless read-only |
| One token per caller, kept in a secret | Token from a secret store |
| Messages treated as untrusted input | Answers treated as outside content |
| Only the tools the skill needs | Only the data the task needs |
| Budgets, approvals and logs as for any run | Timeout that cancels, budget, outbound rules |
| Tasks recorded for tests | Answer recorded once, never called from a replay |

## Remote agents in L2M

L2M implements A2A 1.0 over the JSON-RPC binding, and also answers and calls agents that speak 0.3 ([A2A agents](/runtime/a2a-agents)). Both directions are optional nodes.

**Publishing.** An **Expose as A2A Agent** trigger serves a workflow as an agent. Its card is at `/a2a/<path>/.well-known/agent-card.json` and is public; the endpoint is `POST /a2a/<path>`. **Auth Mode** is an L2M API key (the default), a bearer token kept in a secret (every task is refused until a secret is picked), or public, which saving the workflow warns about. Each task is one production run: run history lists it with the trigger type `a2a`, and budgets, the queue, approvals, capture for replay and the release channel apply to it as to any run. A run waiting for an approval shows to the caller as `TASK_STATE_INPUT_REQUIRED`.

**Calling.** An **A2A Agent** node calls a remote agent, as a step or as a worker on a Supervisor's `worker` port, where the supervisor sees it as one more worker tool. **Check agent** reads the card and shows its name, version and skills. The token comes from a secret. Then the protections above:

- **Approval.** When the workflow's **Ask before write tools** setting is on, each delegation to an A2A worker pauses for an approval, once per exact call, unless the node is marked **Read-only agent**, which is off by default.
- **Timeout.** `timeoutMs` defaults to 120,000 ms. On a timeout the node cancels the task at the remote agent and fails.
- **Outbound rules.** L2M calls only the host in the Agent URL: a card that names an endpoint on another host is refused. Every request goes through the deployment's [outbound URL checks](/security/outbound-url-checks), and a token is never sent on a redirect to another host.
- **Replay.** A replay treats the node as a write step and never calls the remote agent again.
- **Budgets.** The calling run and, when the remote agent is another L2M workflow, the served task are both runs, and [budgets](/product/budgets) apply to each.

To try it without a remote agent, point the node at `mock-a2a://echo`, a built-in test agent; the **A2A agent round trip** sample uses it.

## Further reading

- [A2A Protocol Specification](https://a2a-protocol.org/latest/specification/) (a2a-protocol.org): Agent Cards, tasks, the JSON-RPC binding and security considerations
- Related guides: [MCP vs A2A](/learn/mcp/mcp-vs-a2a), [Supervisor and worker agents](/learn/agents/supervisor-and-workers), [Prompt injection](/learn/security/prompt-injection), [Least privilege for agents](/learn/security/least-privilege-for-agents)
- In L2M: [A2A agents](/runtime/a2a-agents), [Outbound URL checks](/security/outbound-url-checks), [Approvals](/product/approvals)
