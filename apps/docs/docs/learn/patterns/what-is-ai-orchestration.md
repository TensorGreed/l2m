---
title: "What is AI orchestration? Patterns and examples"
sidebarTitle: "What is AI orchestration?"
description: "AI orchestration explained: what gets coordinated, fixed workflows vs agent control, five common patterns, and a small orchestrator in plain JavaScript."
level: beginner
about: ai-orchestration
related: [ai-orchestration, workflow-dag, ai-agent, agent-loop, approval-gate, supervisor-agent]
---

# What is AI orchestration?

<Term id="ai-orchestration">AI orchestration</Term> is the code around model calls that makes them do a job together: it decides which step runs when, what each step receives, and what happens when a step fails, is slow or needs a person. The steps can be model calls, tool calls, plain code, people and data lookups. The orchestrator also keeps the state of the run and a record of what happened. AI agent orchestration is the case where a model, not your code, picks some of the steps.

## What gets orchestrated

A useful AI system is rarely one model call. A support reply, for example, may need five kinds of step:

| Kind of step | Example | What the orchestrator has to handle |
|---|---|---|
| Model call | Classify a ticket, draft a reply | Slow answers, rate limits, output in the wrong format |
| Tool call | Look up the order, create a ticket | Errors, side effects, calls that must not run twice |
| Code | Check the draft, format the output | Usually nothing: code is the cheap, predictable part |
| Person | Approve a refund reply | Waiting for hours, timeouts, who may decide |
| Data | Fetch the customer's history, search a knowledge base | Size, freshness, access rights |

The orchestrator is the part that strings these together. It passes the ticket text to the classifier, the classifier's answer to the right drafting step, the draft to a check, and the checked draft to a person. A model on its own does none of this. It only answers the call in front of it.

## Who decides the next step

There are two ways to control the order of steps, and most real systems use both.

- **A fixed workflow.** Your code or a graph fixes the steps before the run starts. A model fills in text at fixed points. Anthropic's "Building effective agents" defines workflows as "systems where LLMs and tools are orchestrated through predefined code paths". A graph whose edges never loop back is a <Term id="workflow-dag">workflow DAG</Term>.
- **Agent-driven control.** A model chooses which tool to call next and when it is done, inside an <Term id="agent-loop">agent loop</Term>. The same guide describes agents as systems where "LLMs dynamically direct their own processes and tool usage".

A fixed workflow is cheaper, easier to test and does the same thing every time. An agent copes with tasks whose steps you cannot list in advance, and costs more in tokens, time and predictability. [Workflows vs agents](/learn/agents/workflows-vs-agents) compares the two in detail and has a rule of thumb for choosing. The short version: fix what you can, and let the model decide only where the path really depends on what the run finds.

## Five common patterns

"Building effective agents" names five workflow patterns. Each is a different answer to "who decides the next step, and when":

1. **Prompt chaining.** Each model call "processes the output of the previous one". The orchestrator runs the steps in order and can put a check in code (the guide calls it a "gate") between two steps, to stop a run that has gone off track.
2. **Routing.** One step "classifies an input and directs it to a specialized followup task". The orchestrator reads the class and picks the branch. The classifier can be a model or plain code.
3. **Parallelization.** Several calls work at once and their outputs are "aggregated programmatically". The guide names two kinds: sectioning (independent parts of one task) and voting (the same task several times). The orchestrator starts the calls, waits for them and combines the answers.
4. **Orchestrator-workers.** "A central LLM dynamically breaks down tasks, delegates them to worker LLMs, and synthesizes their results." Here a model does part of the orchestrating: it decides which subtasks exist. [Supervisor and workers](/learn/agents/supervisor-and-workers) shows this pattern with worker agents as tools.
5. **Evaluator-optimizer.** One call drafts and another evaluates "in a loop" until the draft passes. The orchestrator needs a stopping rule, because the loop's length is decided at run time.

Agents sit past these five: a model calling tools in a loop, with a stopping condition such as a maximum number of iterations. The guide's advice is to start with "the simplest solution possible", and to add a pattern only when it measurably helps.

## What an orchestrator does besides calling models

Calling a model is one line of code. Most of an orchestrator is everything else:

- **State.** Each step's output is kept, so later steps can read it: the router's class, the order record, the draft. A run that pauses for a person must be able to save this state and pick it up later.
- **Retries.** Model and tool calls fail for reasons that pass: a rate limit, an overloaded server, a dropped connection. Retry those, with a growing wait between attempts. Do not retry a call that already changed something unless it is safe to repeat (see <Term id="idempotency">idempotency</Term>).
- **Timeouts.** Every step needs a limit, and so does the whole run. Without one, a hung call holds the run open forever.
- **Approvals.** Before a step that sends, pays or deletes, the orchestrator can pause and ask a person. That turns a run into something that may wait for hours, which is why state matters. [Human in the loop](/learn/agents/human-in-the-loop) covers where to put approvals.
- **Logging and tracing.** A record of each step: what went in, what came out, how long it took, which attempt worked. When a run gives a bad answer, this is the only way to find the step that caused it ([tracing vs logging](/learn/operations/tracing-vs-logging-for-llm-apps)).
- **Limits on loops.** Any loop, an agent's or an evaluator's, needs a cap on rounds. <Term id="max-iterations">Max iterations</Term> is the usual name.

## A tiny orchestrator in code

The file below runs a fixed chain for support tickets: classify, route, draft, check, and ask a person to approve billing replies. Each step goes through one `step` function, which adds a timeout, retries and a trace line. Save it as `orchestrate.mjs` and run `node orchestrate.mjs` with Node.js 20 or later. It needs no package, no key and no network: a stub model answers with fixed rules, and a stub person approves everything.

```js
// orchestrate.mjs: a tiny orchestrator. A fixed chain with a router step, a retry, a timeout,
// an approval and a trace. Run: node orchestrate.mjs

// 1. A stub model: fixed rules instead of a real model, so this runs with no key and no network.
let draftCalls = 0;
async function stubModel(task, input) {
  if (task === "classify") return /charge|refund|invoice/i.test(input) ? "billing" : "technical";
  if (task === "draft") {
    draftCalls += 1;
    if (draftCalls === 1) throw new Error("503 model overloaded"); // fails once, to show a retry
    return `[${input.route}] Thanks for writing in. We are looking at: ${input.ticket}`;
  }
  throw new Error(`stub model has no rule for ${task}`);
}

// 2. A stub person: approves everything. A real one would answer later, from an inbox.
const askPerson = async (question) => "approved";

// 3. The orchestrator: one step at a time, each with a timeout and retries, all recorded.
async function step(run, name, fn, { retries = 0, timeoutMs = 2000 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
    });
    try {
      const output = await Promise.race([fn(run.state), timeout]);
      run.state[name] = output; // later steps read earlier results from the state
      run.trace.push(`${name} #${attempt} ok: ${output}`);
      return output;
    } catch (error) {
      run.trace.push(`${name} #${attempt} error: ${error.message}`);
      if (attempt > retries) throw new Error(`${name} failed after ${attempt} attempt(s)`);
    } finally {
      clearTimeout(timer);
    }
  }
}

// 4. The workflow: classify, route, draft, check, approve if billing. The code fixes the order;
// the model only fills in the classify and draft steps.
async function handleTicket(ticket) {
  const run = { state: { ticket }, trace: [] };
  try {
    const route = await step(run, "classify", (s) => stubModel("classify", s.ticket));
    await step(run, "draft", (s) => stubModel("draft", { route, ticket: s.ticket }), { retries: 2 });
    await step(run, "check", async (s) => {
      if (!s.draft.trim()) throw new Error("empty draft");
      if (/refund (is|has been) (approved|issued)/i.test(s.draft)) throw new Error("draft promises a refund");
      return "passed";
    });
    if (route === "billing") await step(run, "approve", (s) => askPerson(`Send this reply? ${s.draft}`));
    run.status = "sent";
  } catch (error) {
    run.status = `stopped: ${error.message}`;
  }
  return run;
}

for (const ticket of ["I was charged twice on my last invoice", "The app crashes when I log in"]) {
  const run = await handleTicket(ticket);
  console.log(`ticket: ${ticket}`);
  for (const line of run.trace) console.log(`  ${line}`);
  console.log(`  status: ${run.status}\n`);
}
```

The output:

```text
ticket: I was charged twice on my last invoice
  classify #1 ok: billing
  draft #1 error: 503 model overloaded
  draft #2 ok: [billing] Thanks for writing in. We are looking at: I was charged twice on my last invoice
  check #1 ok: passed
  approve #1 ok: approved
  status: sent

ticket: The app crashes when I log in
  classify #1 ok: technical
  draft #1 ok: [technical] Thanks for writing in. We are looking at: The app crashes when I log in
  check #1 ok: passed
  status: sent
```

Read the first ticket's trace. The router sent it down the billing path. The first draft call failed, the orchestrator tried again, and the second attempt worked. The check in code passed, and because the route was billing, a person was asked before the reply went out. The second ticket took the technical path, which has no approval step. Same code, two different paths, both written down.

Three experiments worth a minute each:

- **Make the failure stick.** Change `draftCalls === 1` to `draftCalls <= 3`. All three attempts fail, the run stops with `draft failed after 3 attempt(s)`, and the trace shows each one.
- **Trip the gate.** Make the stub draft say "Your refund has been approved." The check fails, and no person is asked to approve a reply that should never have been written.
- **Make a step hang.** Return `new Promise(() => {})` from the classify rule. After two seconds the timeout ends the step instead of the run waiting forever.

What this sketch leaves out, and a production orchestrator adds: a growing wait between retries, a timeout for the whole run, saving state so a run can wait days for a person, and storing the trace somewhere other than the console.

## In L2M

L2M is an orchestrator of this kind, with the order drawn on a canvas instead of written in code:

- **A workflow DAG.** The engine checks the graph, refuses one with a cycle, and runs the nodes in topological order, one at a time. Nodes on a branch that was not taken are marked skipped ([workflow editor](/product/workflow-editor), [core nodes](/nodes/core-nodes)).
- **Routing and checks.** IF and Switch nodes pick a branch; a Text Classifier node can classify with a model first. Later steps read earlier results with templates such as <span v-pre>`{{results.<nodeId>.field}}`</span> ([templates and expressions](/runtime/templates-and-expressions)).
- **Retries and timeouts.** Nodes that call a model, a tool or the network try once more after a short wait by default, and every node can set its own retries, a delay that doubles, and what to do on error. A whole run stops at `WORKFLOW_EXECUTION_TIMEOUT_MS`, 300000 ms by default, and the steps it did not reach are marked skipped ([errors and retries](/nodes/core-nodes#errors-and-retries)).
- **Agents inside the graph.** An **Agent Orchestrator** node is one step that runs an agent loop, with its model, memory and tools on attachment ports that are not steps themselves. New ones stop after 6 iterations. A **Supervisor Node** adds a `worker` port: each attached agent becomes a `delegate_to_<name>` tool, which is the orchestrator-workers pattern ([agent loop](/runtime/agent-loop)).
- **Approvals.** **Human Approval** and **Approval Gate** nodes pause the run until a person decides; an Approval Gate routes to approved, rejected or timed out ([approvals](/product/approvals)).

The [pattern library](/patterns/) has importable samples of these shapes.

## Further reading

- [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) (Anthropic engineering, December 2024): workflows vs agents and the five workflow patterns
- Related guides: [Workflows vs agents](/learn/agents/workflows-vs-agents), [An AI agent loop in about 30 lines of code](/learn/agents/agent-loop-in-code), [Supervisor and workers](/learn/agents/supervisor-and-workers), [Human in the loop](/learn/agents/human-in-the-loop), [LLM-as-judge vs deterministic checks](/learn/testing/llm-as-judge-vs-deterministic-checks)
- In L2M: [Workflow editor](/product/workflow-editor), [Core nodes](/nodes/core-nodes), [Agent loop](/runtime/agent-loop), [Approvals](/product/approvals)
