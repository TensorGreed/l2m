---
title: "A2A agents: publish workflows and call remote agents"
description: "Serve an L2M workflow as an Agent2Agent (A2A) agent with an Agent Card and JSON-RPC endpoint, and call remote A2A agents from a workflow or a Supervisor."
---

# A2A Agents

MCP is how agents reach tools. [Agent2Agent (A2A)](https://a2a-protocol.org/) is how agents reach other agents. L2M speaks both, in one governed runtime:

- **Expose as A2A Agent** (trigger, `a2a_trigger`) publishes a workflow as an A2A agent, with an Agent Card that other agents discover and a JSON-RPC endpoint they send tasks to.
- **A2A Agent** (`a2a_agent`) calls a remote A2A agent, either as a step in a workflow or as a worker of a Supervisor.

Both are optional. A workflow without A2A nodes runs exactly as before.

L2M implements A2A 1.0 over the JSON-RPC binding, and also answers and calls agents that still speak 0.3.

## Publish a workflow as an A2A agent

1. Add an **Expose as A2A Agent** trigger and connect it to the rest of the workflow. The caller's message is <span v-pre>`{{user_prompt}}`</span>; a JSON data part in the message is <span v-pre>`{{data}}`</span>.
2. Give it an **Agent Path** (a new node gets one) and, optionally, a name and a description. The name defaults to the workflow's name.
3. Pick an **Auth Mode** (see below) and save. If production runs a published version, publish.
4. Copy the **Agent Card URL** from the node and give it to the calling agent.

| URL | What it is |
|---|---|
| `GET /a2a/<path>/.well-known/agent-card.json` | The Agent Card: name, description, one skill, the endpoint, streaming support and the auth scheme. Public, as discovery needs. |
| `POST /a2a/<path>` | The JSON-RPC endpoint. |

The endpoint takes these methods (the 0.3 names work too):

| Method | 0.3 name | What it does |
|---|---|---|
| `SendMessage` | `message/send` | Runs the workflow and answers the finished task. With `configuration.returnImmediately: true` (0.3: `blocking: false`) it answers a working task at once. |
| `SendStreamingMessage` | `message/stream` | The same, as server-sent events: the task, `WORKING`, the output as an artifact, then the final status. |
| `GetTask` | `tasks/get` | Reads a task. |
| `CancelTask` | `tasks/cancel` | Cancels a task that has not ended, as **Cancel** in run history does. |

Push notifications are not supported (their methods answer `-32003`), and the card says so.

### Tasks are runs

Each task is one production run of the workflow: the task id is the execution id, and the message's `contextId` is the run's session id (so Simple Memory carries a conversation across tasks in one context). Runs appear in run history with the trigger type `a2a`, and everything that applies to production runs applies: budgets and the queue, approvals, response content rules, capture for replay, and the release channel.

| Run status | Task state |
|---|---|
| running, queued | `TASK_STATE_WORKING` |
| waiting for an approval | `TASK_STATE_INPUT_REQUIRED` |
| success | `TASK_STATE_COMPLETED`, with the output as an artifact (a text part and a data part) |
| error, or a withheld answer | `TASK_STATE_FAILED` |
| canceled | `TASK_STATE_CANCELED` |

A task waiting for an approval continues when a person decides in L2M. The caller then reads the result with `GetTask`. Follow-up messages into an existing task are refused (`-32004`); send a new message in the same context instead.

### Auth modes

| Mode | Callers send |
|---|---|
| `api_key` (default) | An L2M API key in `Authorization: Bearer`, of a user with the operator role or above who may run the workflow. A key limited to projects is refused. The run is recorded as that user's. |
| `bearer` | The token stored in the trigger's secret, in `Authorization: Bearer`. Until a secret is picked, every task is refused. |
| `public` | Nothing. Anyone with the URL can send tasks; saving the workflow warns about it. |

A switched-off trigger answers "not found". A deactivated workflow refuses tasks, and only its signed-in editors are told why. A published version with unfinished settings answers `workflow_unfinished` and starts no run.

### Behind a proxy

Set `APP_PUBLIC_URL` so the card names the public endpoint. The bundled nginx configurations forward `/a2a/` with buffering off for streaming.

## Call a remote A2A agent

Add an **A2A Agent** node and set its **Agent URL**: the remote agent's base URL or its Agent Card URL. **Check agent** reads the card and shows its name, version and skills.

| Field | Default | Description |
|---|---|---|
| `cardUrl` | (required) | The agent's base URL or card URL. `/.well-known/agent-card.json` is added when missing. |
| `secretRef` | none | A secret whose value is sent as `Authorization: Bearer` to the agent. |
| `messageTemplate` | <span v-pre>`{{user_prompt}}`</span> | The message to send. |
| `timeoutMs` | `120000` | How long the remote task may take. On timeout the node cancels the task there and fails. |
| `toolDescription` | a generic line naming the node | What a Supervisor reads about this worker. Describe what the agent is good at. |
| `readOnly` | off | Turn on only when the agent changes nothing: its worker calls then skip write-tool approval. |

The node outputs `text`, `state` (`completed` or `input-required`), `data` (the first data part), `taskId`, `contextId`, `artifacts` and `agent`. A failed, rejected or canceled task fails the node.

### As a step

Connect it like any other node. Downstream nodes read <span v-pre>`{{text}}`</span> and <span v-pre>`{{data}}`</span>.

### As a Supervisor worker

Attach the node to a Supervisor's `worker` port. The supervisor sees it as a worker tool, next to its local agents, and delegates a task to it the same way. The task is the message unless the node sets one.

When the supervisor has write-tool approval on, each call to an A2A worker pauses for an approval (as a write tool does) unless the node is marked read-only. Run traces and node activity record the call. A replay treats the node as a write step: it never calls the remote agent again.

### Outbound rules

L2M calls only the host in the Agent URL: a card that names an endpoint on another host is refused, so use the card URL on the endpoint's own host.

Every request to a remote agent, the card and the endpoint, goes through the deployment's outbound URL rules: cloud metadata and link-local addresses are always refused, private addresses are refused under `OUTBOUND_DENY_PRIVATE` unless allowlisted, the connection is pinned to the checked address, and redirects are checked again. Destination rules apply to the message sent, and to each redirect before it is followed. A token is never sent on a redirect to another host.

### Try it without a remote agent

`mock-a2a://echo` is a built-in test agent that answers `Echo: <message>`. `mock-a2a://ask` asks a question back (`input-required`), `mock-a2a://fail` fails, and `mock-a2a://slow` finishes after a moment. The **A2A agent round trip** sample uses it.

## L2M calling L2M

Point an A2A Agent node in one workflow (or one L2M deployment) at another workflow's Agent Card URL, with a secret holding a key or token that agent accepts. The calling run and the served run are both in run history: one with the A2A Agent step, the other with the trigger type `a2a`.
