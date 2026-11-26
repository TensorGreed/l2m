---
title: "VS Code extension: run a workflow as a coding agent"
description: "The L2M VS Code extension turns a workflow into a coding agent in the editor: streaming chat, patch previews, command approval and bounded context."
---

# VS Code Agent Extension

The L2M VS Code extension turns any L2M workflow into a coding agent inside the editor. Streaming chat, structured patch previews with workspace-path safety, command approval, and bounded context bundling — backed by a workflow you own and can edit visually.

## What you get

- A sidebar **L2M Agent** view with persistent chat per workspace.
- Streaming responses via `POST /api/webhooks/execute/stream` (SSE).
- Bounded context bundling: active file, selection, open tabs, diagnostics, git state, pinned files. Configurable budgets.
- Structured action handling: code blocks render with copy/insert, suggested file patches preview before apply with workspace-path validation, suggested commands run only after explicit approval in a VS Code terminal.
- Local session memory with deterministic compaction — older turns get summarised, recent turns sent in full.

## Install

Install **L2M Agent** from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=l2m.vscode-l2m-agent) or, in VSCodium, Cursor and other editors that use Open VSX, from [Open VSX](https://open-vsx.org/extension/l2m/vscode-l2m-agent): search for "L2M Agent" in the Extensions view, or run:

```bash
code --install-extension l2m.vscode-l2m-agent
```

To try changes that aren't released yet, see [Development build](#development-build) at the end of this page.

## Connect it to your L2M instance

The extension talks to L2M over the standard webhook routes (no special server changes needed). You'll wire up four things:

1. **Pick or import a workflow**: the easiest start is the bundled VS Code Coding Agent template.
2. **Mint an API key** so the extension can authenticate.
3. **Check the connection** with one `curl` call.
4. **Configure the extension** to point at your L2M and the workflow.

First, find your L2M address. It depends on how you run L2M:

| You run L2M with | Address (`l2mAgent.apiBaseUrl`) |
|---|---|
| Docker ([install](./install), the README's quickstart) | `http://localhost:8080`, the studio's port. It forwards `/api` to the API. |
| From source (`pnpm dev`, [run from source](./run-from-source)) | `http://localhost:4000`, the API's own port. This is the extension's default. |

If you changed `L2M_PORT` or run L2M on another host, use that address instead.

### 1. Import the VS Code Coding Agent template

Open the L2M web UI, click **Templates** in the sidebar, and click **Use Template** on **VS Code L2M Coding Agent** (in the **Agents** category). Save it. Note the resulting workflow ID (visible in the editor URL or the workflow header).

The template implements the full structured-response contract the extension expects: `message`, `actions[]` (patch + command), `codes[]`, `attachments[]`, `context_update`, `follow_up_question`. As shipped, its chat model is `qwen2.5:7b` on a local Ollama server (`http://localhost:11434/v1`). Pull that model, or switch the **Chat Model** node to OpenAI, Anthropic or another provider.

With Docker, `localhost` inside the API container is the container itself, not your machine. To use an Ollama running on your machine, open the **Chat Model** node and set **Base URL** to `http://host.docker.internal:11434/v1`. The quickstart compose file maps `host.docker.internal` to your machine on Linux too.

**No model yet?** You can still try the chat. Click **Use Template** on **MCP Agent Quickstart** (in **Getting Started**) and use that workflow's ID in step 4 instead. It runs on the built-in **Echo** test model, which needs no key: it repeats your message back. That is not a coding agent, but it proves the extension reaches L2M. Echo is no use with the coding template itself: that template expects a JSON answer, which Echo cannot write.

### 2. Mint an API key

In the L2M web UI: **Settings** → **API Keys**. Type a name and click **Generate key**. Copy the full key (`ao_<prefix>.<secret>`). It is shown only once.

### 3. Check the connection

Before you open VS Code, send one request the way the extension does. Use your address, workflow ID and key:

```bash
curl -s http://localhost:8080/api/webhooks/execute \
  -H "Authorization: Bearer ao_<prefix>.<secret>" \
  -H "Content-Type: application/json" \
  -d '{"workflow_id": "<workflow ID>", "user_prompt": "Hello", "session_id": "curl-check"}'
```

From source, use `http://localhost:4000` instead. The answer is the run as JSON:

- `"status": "success"`: L2M, the key and the workflow all work.
- `401` or `403`: the key is missing, mistyped or revoked.
- `404`: the workflow ID is wrong, or the key cannot see that workflow.
- `"status": "error"` with an `error` message: L2M was reached, but the run failed. A model that cannot be reached shows up here, for example Ollama on `localhost` from inside Docker (see step 1).
- `Connection refused`: nothing listens on that address. Check the port in the table above.

### 4. Configure the extension

`Cmd/Ctrl + ,` to open VS Code Settings, search for **L2M Agent**. Set:

| Setting | Value |
|---|---|
| `l2mAgent.apiBaseUrl` | Your address from the table above: `http://localhost:8080` (Docker) or `http://localhost:4000` (from source) |
| `l2mAgent.workflowId` | The workflow ID from step 1 |
| `l2mAgent.authToken` | The API key from step 2 |
| `l2mAgent.streamResponses` | `true` (recommended) |

`workflowId` is optional. Leaving it blank falls back to looking up a workflow by `l2mAgent.webhookPath` (default `vscode-l2m-agent`). Put the key in your user settings, not in a workspace `settings.json` that might be committed.

### 5. Open the chat

Click the **L2M Agent** icon in the Activity Bar (left rail). Type a message in the sidebar chat. You'll see streaming progress events, then the assistant's response. Code blocks come with copy/insert buttons; patch and command actions show a preview before anything touches your workspace.

## Commands

| Command | Description |
|---|---|
| `L2M Agent: Open Chat` | Reveal the sidebar chat |
| `L2M Agent: New Session` | Clear visible chat history and reset session memory |
| `L2M Agent: Pin Active File` | Attach the current file to subsequent context bundles |
| `L2M Agent: Send Selection` | Send the current editor selection as a chat message |
| `L2M Agent: Reset Memory` | Clear the local compacted-memory cache (keeps chat history) |

## Context budget tuning

The extension truncates predictably to fit a model's context. The defaults are conservative; raise these if you have a large-context model (Claude, GPT-4o):

- `l2mAgent.maxContextChars` — total approximate chars sent per request (default 60000)
- `l2mAgent.maxFileChars` — per active or pinned file (default 12000)
- `l2mAgent.maxGitDiffChars` — per git diff (default 20000)
- `l2mAgent.maxDiagnostics` — max VS Code diagnostics included (default 50)
- `l2mAgent.recentTurnCount` — recent turns sent in full before older turns are summarised (default 12)

Lower these for small-context local models (8B Llama, etc.).

## Safety model

By design:

- **No file edit happens without explicit user approval.** Every patch action shows a preview with the diff and the target file path. Approval is a modal dialog, not a notification toast.
- **Patches cannot write outside the workspace.** Each path is resolved against the first workspace folder, and a path that ends up outside it (through `..` or an absolute path) is rejected. The check works on the path text; it does not resolve symbolic links.
- **Commands are visible and approved before execution.** The agent's suggested command renders in the chat with a Run button; clicking it runs in a VS Code terminal you can watch. The extension never auto-runs.

## Troubleshooting

**Connection refused** — the address is wrong for how you run L2M. Docker serves on `http://localhost:8080`; from source the API is on `http://localhost:4000`. Run the `curl` check in step 3.

**Streaming hangs or times out** — bump `l2mAgent.requestTimeoutMs`. The extension enforces this on the full stream, not just the initial response.

**"Workflow not found" in the chat** — the configured `workflowId` doesn't exist on the connected instance. Open the workflow in the L2M web UI and re-copy the ID from the editor URL.

**401 / 403 on every send** — the API key is missing, mistyped, or revoked. Generate one in **Settings** → **API Keys** and re-paste.

**Patch preview shows the wrong content** — the workflow returned a malformed diff. The extension only applies single-file unified diffs; complex multi-file patches are out of scope. Tighten the system prompt in your workflow to constrain the output.

## What it isn't

- It does not call OpenAI/Anthropic/etc. directly. The agent's reasoning lives in the L2M workflow you point it at — swap models server-side without touching the extension.
- It does not give the workflow unrestricted filesystem access. Only the bounded context bundle is sent; the extension is a client, not a runtime.
- It does not run shell commands automatically. Approval is required.

## Development build

To try changes that aren't released yet, install a `.vsix` directly.

**From CI.** Every CI run on `main` produces a `vscode-l2m-agent-vsix` workflow artifact. Download the latest one from the [Actions tab](https://github.com/TensorGreed/l2m/actions), unzip, and:

```bash
code --install-extension vscode-l2m-agent.vsix
```

**From source.**

```bash
pnpm install
pnpm --filter ./apps/vscode-l2m-agent build
pnpm --filter ./apps/vscode-l2m-agent run package
code --install-extension apps/vscode-l2m-agent/vscode-l2m-agent.vsix
```

## Related

- [Why L2M?](../why) — the agent-composability story the extension plugs into
- [Expose a Workflow as an MCP Tool](../runtime/workflow-as-mcp-tool) — the inverse direction (other agents calling your L2M workflows)
