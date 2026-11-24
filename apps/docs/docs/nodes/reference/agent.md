---
title: "Agent nodes: config fields and defaults"
description: "Reference for the 4 nodes in the L2M Agent category, with every config field and default."
---

<!--
  Generated from packages/shared/src/definitions.ts.
  DO NOT EDIT BY HAND — run `pnpm --filter @ai-orchestrator/docs gen:nodes`
  (or `pnpm docs:build`) to regenerate.
-->

# Agent nodes

Tool-calling agent runtimes and the multi-turn memory + artifact stores that back them.

4 nodes.

Fields that take <span v-pre>`{{ }}`</span> templates (prompts, URLs, bodies, values) read the steps connected straight into the node; [Templates and expressions](/runtime/templates-and-expressions) covers reading earlier steps with `results`.

---
### `a2a_agent` — A2A Agent

Sends a task to a remote Agent2Agent (A2A) agent and outputs its answer. Use it as a step, or attach it to a Supervisor's worker port to let the supervisor delegate to the remote agent like a local worker. The URL goes through the outbound URL checks; a token comes only from a secret.

**Config fields**

| Field | Type | Required | Values |
|---|---|---|---|
| `cardUrl` | `string` | yes | — |
| `secretRef` | `object` | no | — |
| `messageTemplate` | `string` | no | — |
| `timeoutMs` | `number` | no | — |
| `toolDescription` | `string` | no | — |
| `readOnly` | `boolean` | no | — |

**Outputs**

| Field | What it holds |
|---|---|
| `text` | The remote agent's answer as text (its message, else its artifacts' text parts). |
| `state` | The task's final state: completed, or input-required when the remote agent asks for more. |
| `taskId` | The remote task's id. |
| `contextId` | The remote conversation's id. |
| `artifacts` | The task's artifacts as the remote agent sent them. |
| `data` | The data parts of the answer (one object when there is one). |
| `agent` | The remote agent's name and endpoint. |

**Example config**

```json
{
  "cardUrl": "https://agents.example.com/research/.well-known/agent-card.json",
  "messageTemplate": "{{user_prompt}}",
  "timeoutMs": 120000
}
```

---

### `agent_orchestrator` — Agent Orchestrator

Runs iterative tool-aware agent loop.

**Config fields**

| Field | Type | Required | Values |
|---|---|---|---|
| `agentType` | `string` | no | `tools` \| `react` \| `plan-and-execute` \| `sql` |
| `serverPrompt` | `object` | no | — |
| `systemPromptTemplate` | `string` | no | — |
| `userPromptTemplate` | `string` | no | — |
| `sessionIdTemplate` | `string` | no | — |
| `maxIterations` | `number` | yes | — |
| `toolCallingEnabled` | `boolean` | no | — |
| `thinkTool` | `boolean` | no | — |
| `toolMessageMaxChars` | `number` | no | — |
| `toolPayloadMaxDepth` | `number` | no | — |
| `toolPayloadMaxObjectKeys` | `number` | no | — |
| `toolPayloadMaxArrayItems` | `number` | no | — |
| `toolPayloadMaxStringChars` | `number` | no | — |

**Outputs**

| Field | What it holds |
|---|---|
| `answer` | The agent's final answer as text. |
| `iterations` | How many model turns it took. |
| `stopReason` | Why the agent stopped (final_answer, max_iterations, clarification_requested...). |
| `steps` | Each turn: what the model asked for and the tools it called. |
| `messages` | The whole conversation with the model. |
| `clarification` | The question the agent asked back, when it paused to ask one. |

**Example config**

```json
{
  "agentType": "tools",
  "systemPromptTemplate": "{{system_prompt}}",
  "userPromptTemplate": "{{user_prompt}}",
  "sessionIdTemplate": "{{session_id}}",
  "maxIterations": 6,
  "toolCallingEnabled": true,
  "toolMessageMaxChars": 6000,
  "toolPayloadMaxDepth": 4,
  "toolPayloadMaxObjectKeys": 32,
  "toolPayloadMaxArrayItems": 8,
  "toolPayloadMaxStringChars": 400
}
```

---

### `supervisor_node` — Supervisor Node

Swarm Supervisor that coordinates attached Worker nodes.

**Config fields**

| Field | Type | Required | Values |
|---|---|---|---|
| `serverPrompt` | `object` | no | — |
| `systemPromptTemplate` | `string` | no | — |
| `userPromptTemplate` | `string` | no | — |
| `sessionIdTemplate` | `string` | no | — |
| `maxIterations` | `number` | yes | — |
| `thinkTool` | `boolean` | no | — |
| `toolMessageMaxChars` | `number` | no | — |
| `toolPayloadMaxDepth` | `number` | no | — |
| `toolPayloadMaxObjectKeys` | `number` | no | — |
| `toolPayloadMaxArrayItems` | `number` | no | — |
| `toolPayloadMaxStringChars` | `number` | no | — |

**Outputs**

| Field | What it holds |
|---|---|
| `answer` | The agent's final answer as text. |
| `iterations` | How many model turns it took. |
| `stopReason` | Why the agent stopped (final_answer, max_iterations, clarification_requested...). |
| `steps` | Each turn: what the model asked for and the tools it called. |
| `messages` | The whole conversation with the model. |
| `clarification` | The question the agent asked back, when it paused to ask one. |

**Example config**

```json
{
  "systemPromptTemplate": "{{system_prompt}}",
  "userPromptTemplate": "{{user_prompt}}",
  "sessionIdTemplate": "{{session_id}}",
  "maxIterations": 10,
  "toolMessageMaxChars": 6000,
  "toolPayloadMaxDepth": 4,
  "toolPayloadMaxObjectKeys": 32,
  "toolPayloadMaxArrayItems": 8,
  "toolPayloadMaxStringChars": 400
}
```

---

### `workflow_tool` — Workflow Tool

Lets an agent call another workflow as a tool. Attach it to an Agent or Supervisor tool port. The tool's name, description and input schema come from the workflow's Expose as MCP Tool or Sub-Workflow Trigger node.

**Config fields**

| Field | Type | Required | Values |
|---|---|---|---|
| `workflowId` | `string` | yes | — |
| `toolName` | `string` | no | — |
| `toolDescription` | `string` | no | — |
| `timeoutMs` | `number` | no | — |

**Example config**

```json
{
  "workflowId": ""
}
```
