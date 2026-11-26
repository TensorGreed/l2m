---
title: "Build your first MCP agent in 5 minutes, no API keys"
description: "Tutorial: from a fresh Docker or source install to an L2M agent wired to MCP tools in five minutes, no API keys; add a real model to see it call them."
---

# Build your first MCP agent in 5 minutes

This is the shortest path from a fresh install to an agent wired to tools via the [Model Context Protocol](https://modelcontextprotocol.io/), ready to call them once you add a real model. No API keys, no Ollama, no setup.

New to the ideas? [What is MCP?](/learn/mcp/what-is-mcp) and [What is an AI agent?](/learn/agents/what-is-an-ai-agent) explain them in a few minutes each.

By the end you'll have:
- L2M running on your machine, with the studio open in your browser.
- A working agent wired to two MCP tools (`get_current_time`, `calculator`), ready for a real model to call them.
- A clear next step for swapping the bundled echo provider for a real LLM and the in-process mock MCP server for a real one (filesystem, git, postgres, etc.).

## 1. Start L2M

Pick one track. Docker is the quickest; from source is for working on L2M itself.

### Docker (≈ 2 min)

You need Docker with Compose. In an empty folder, run:

```bash
curl -fsSL https://lsquarem.com/install.sh | sh
```

Prefer not to pipe a script into a shell? These two commands do the same:

```bash
curl -fsSL https://raw.githubusercontent.com/TensorGreed/l2m/v0.1.1/docker-compose.quickstart.yml -o docker-compose.yml
docker compose up -d
```

Open `http://localhost:8080` and sign in as `admin@l2m.local`. The installer prints the password; with the two commands, it is printed once in `docker compose logs api`. Nothing else to configure. More options: [Install with Docker](./install).

### From source (≈ 3 min)

You need Node.js 24+ and pnpm 10+.

```bash
git clone https://github.com/TensorGreed/l2m.git
cd l2m
pnpm install
cp .env.example .env
```

Generate a master key for secret encryption:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Open `.env` and set:

```
SECRET_MASTER_KEY_BASE64=<paste the key from above>
BOOTSTRAP_ADMIN_EMAIL=you@example.com
BOOTSTRAP_ADMIN_PASSWORD=ChangeMe123!
```

You don't need to set `OPENAI_API_KEY`, `OLLAMA_BASE_URL`, or anything else for this tutorial. Then start it:

```bash
pnpm dev
```

Wait for the API to log `listening on 4000` and the Web UI to log `Local: http://localhost:5173/`, then open `http://localhost:5173` and sign in with the admin credentials from your `.env`. More: [Run from source](./run-from-source).

The rest of this tutorial is the same for both tracks.

## 2. Open the MCP Agent Quickstart template (≈ 30 s)

In the studio:
1. Click **Templates** in the sidebar.
2. Click the **Getting Started** category.
3. On **MCP Agent Quickstart**, click **Use Template**. The workflow opens in the editor.

What you should see on the canvas:

```
Manual Trigger ──▶ Agent ──▶ Output
                    │
                    ├── chat_model: Chat Model (echo)
                    ├── tool:       MCP: get_current_time
                    └── tool:       MCP: calculator
```

The three nodes hanging off the agent are **attachment ports**, not DAG steps — the agent runtime consumes them at execution time. See [the agent loop](/runtime/agent-loop) for the mental model.

## 3. Run it (≈ 30 s)

Click the **Run** button in the top-right of the canvas. Next to it is **Input**, the prompt a Run sends as
<span v-pre>`{{user_prompt}}`</span>. This template's agent reads that prompt, and its Manual Trigger's test data has
one, so Input shows `sample: …` and the first Run works on it straight away:

```
What time is it in UTC, and what is 2+2?
```

To ask something else, click **Input**, type your own prompt and click **Run** in the box. Input is remembered for
this workflow in this browser, so the next Run sends it again. Clear it to go back to the sample. A workflow that reads
the prompt and has no test data asks first: Run opens Input with "This workflow works on a prompt".

Open **Runs** in the sidebar. The most recent run shows:

- Manual Trigger → success
- Chat Model (echo), MCP: get_current_time and MCP: calculator → skipped as steps (they are attachments, not DAG steps), then marked as used by the agent, which loaded the model and the tool definitions
- Agent → success, after one model call
- Output → success, with an answer that starts `Echo: What time is it in UTC, and what is 2+2?` and says why Echo called no tool

No tool was called, and that is expected. The bundled `echo` provider is not a real model: it repeats your prompt and
cannot choose tools. With tools attached it makes at most one demo tool call per run, labelled as one: `Echo test
model: demo call to <tool>`. It calls only a tool L2M classifies read-only (an admin marked it read-only, a built-in
tool, or a read-only workflow tool); a server's own read-only hint is not enough. It never makes up a required input.
The sample server's tools are not marked read-only, so Echo calls none and its answer says why. The **Agent that calls
a tool** starter on Home shows the demo call with no key: its answer says which tool Echo called and what it returned.
What this run proves is the wiring: the trigger reaches the agent, the agent loads its model and its MCP tools, and
the answer reaches the output.

To see tool calls without a key, open the [support agent in the live demo](https://lsquarem.com/demo/?mode=editor&workflowId=wf-demo-support-agent&demoRun=recorded){target="_self"}. Its recorded run shows the agent calling a knowledge-base tool and a calculator, one call failing and being retried. To make tool calls on your own machine, swap echo for a real model (next step). [What is an AI agent?](/learn/agents/what-is-an-ai-agent) explains the loop you will then see.

## 4. Make it real

You have two swaps to make. Both take a minute.

### Swap the chat model for a real LLM

In Studio: open the **Chat Model (echo)** node, change the **Provider** dropdown from `echo` to `openai` (or `anthropic`, `gemini`, `ollama`).

For OpenAI:
1. Click **Secrets** in the sidebar. Under **Create secret**, set **Name** to `OPENAI_API_KEY`, **Provider** to `openai`, paste your key and click **Create secret**.
2. Back on the node, set **Model** to `gpt-4o-mini` and pick the secret you just created as **API Key Secret**.
3. Save the workflow and re-run with the same prompt.

You'll see the model actually reason about which tools to call, in what order, with what arguments — instead of the echo placeholder.

### Swap the mock MCP for a real MCP server

The `mock-mcp` adapter is in-process and ships with a few demo tools (`get_current_time`, `calculator`, `lookup_kb` and others). To plug in a community MCP server (e.g. `@modelcontextprotocol/server-filesystem` for filesystem access):

1. Replace one of the `MCP: …` nodes with a new **MCP Tool** node.
2. Set the connection:
    - **MCP Server Adapter**: `stdio_mcp`
    - **Command**: `npx`
    - **Arguments (one per line)**: three lines, `-y`, then `@modelcontextprotocol/server-filesystem@2.3.0`, then `/path/to/your/safe/dir`. With Docker the server runs inside the API container, so the path is a folder in the container (for example `/app/apps/api/data`).
3. Click **Discover Tools**. The studio starts the server and lists its tools. Leave **Tools To Include** on all discovered tools, or pick some.
4. Save and run with an **Input** like `List files in the project root and tell me which ones look like documentation.`

That's the whole loop: visual workflow + agent runtime + MCP tool calls. See [the MCP integration page](/extensions/mcp) for transport options and best practices, and [agent loop](/runtime/agent-loop) for the iteration semantics.

Next steps: the [zero-key MCP agent recipe](/recipes/zero-key-mcp-agent) walks through this workflow node by node and lists ways to extend it, and the glossary defines an [MCP tool](/glossary/mcp-tool).

## What if it didn't work

- Docker: the page at `http://localhost:8080` does not load → run `docker compose ps` and wait until both services are up; `docker compose logs api` shows why the API stopped. Another program may hold port 8080: set `L2M_PORT` (see [Install with Docker](./install)).
- From source: blank page or "API unreachable" → make sure both the API (`pnpm --filter @ai-orchestrator/api dev`) and Web (`pnpm --filter @ai-orchestrator/web dev`) processes are running. `pnpm dev` runs both, but your terminal needs to stay open.
- From source: login fails → the `BOOTSTRAP_ADMIN_*` env vars only seed the admin user on first boot when the user table is empty. If you've already logged in once with different credentials, those persist in `apps/api/data/orchestrator.db`. Delete the file and restart to re-seed.
- Anything else → see [common issues](/troubleshooting/common-issues) or open an issue on [GitHub](https://github.com/TensorGreed/l2m/issues).
