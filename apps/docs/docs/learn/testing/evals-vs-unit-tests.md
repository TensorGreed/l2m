---
title: "Agent evals vs unit tests: why agents regress quietly"
sidebarTitle: "Evals vs unit tests"
description: "Code fails loudly; agents fail quietly with a fluent answer. What to test instead of exact words: tool calls, arguments, steps and facts, on recorded data."
level: intermediate
about: eval
related: [eval, regression-eval, golden-run, replay, cassette, pass-at-k]
---

# Agent evals vs unit tests

A unit test checks that code returns an exact value, and a broken function fails it loudly. An agent fails quietly: after a prompt edit or a model update it still answers, the answer still reads well, and nothing logs an error. So you do not test an agent by its exact words. You test its behaviour: which tools it called, with which arguments, whether it finished and in how many steps, and whether the answer holds the facts that matter. Recorded tool answers and known-good runs make those tests repeatable. Unit tests still cover the parts of an agent that are plain code.

## Code fails loudly, agents fail quietly

Break a function and a test goes red, or the program crashes. The failure is visible and points at a line.

An agent has parts that are not code, and each can change its behaviour without any error:

- **A reworded prompt.** One added sentence fixes the case you were looking at and makes the agent skip a lookup in another.
- **A new model version.** Same provider, same name with a new date, and it now prefers a different tool or answers in another format.
- **An edited tool description.** Someone tidies the wording on a server, and the model stops choosing that tool for half the questions it used to handle.
- **A changed tool result.** A server renames a field, and the agent's next step reads nothing where it used to read a tracking number.

The run still ends with status "success". The answer is fluent. It may even be right for the test you tried by hand. That is a silent regression, and the only defence is a test that runs the cases you already know should work, every time something changes ([regression testing agents](/learn/testing/regression-testing-agents)).

## What changes, side by side

| | Unit test | Agent eval |
|---|---|---|
| What it checks | An exact return value | Behaviour: tool calls, arguments, steps, key facts, status, cost |
| The same input twice | The same result | Possibly another path, or other words for the same answer |
| How a failure shows | An error or a red test | A different, still plausible answer |
| Outside systems | Mocked by hand | Answered from a recording of a real run |
| Result | Pass or fail | Pass, fail or inconclusive; often a pass rate over several tries |
| What a change usually is | A code change | A prompt, model, tool or setting change |

An <Term id="eval">eval</Term> is the general name for a test of a model or agent; the kind that protects known-good behaviour is a <Term id="regression-eval">regression eval</Term>.

## What to assert instead of exact words

The same right answer can be phrased many ways, so an assertion on the full text fails good runs and teaches people to ignore red tests. Assert the things that decide whether the run did its job:

- **Tool calls.** The agent called `get_order` and then `track_shipment`. Or, looser: it called `track_shipment` at some point, and it never called `refund_order` on a question that only asked where a parcel is.
- **Arguments.** `get_order` got `order_id: "A-1001"`, the id from the question.
- **Finishing.** It gave a final answer, not a stop at the step limit, and in no more than four steps.
- **Key facts.** The answer contains "Thursday", the delivery day the tool returned.
- **Cost.** It did not use twice the tokens of the known-good run.

Grade the outcome first and the path second. If two routes are both correct, check only the steps that matter, such as "the write happened once, with the right amount". The [agent evals guide](/learn/testing/agent-evals) covers graders and pass rates in more depth, and [LLM-as-judge vs deterministic checks](/learn/testing/llm-as-judge-vs-deterministic-checks) covers when a check needs a model to grade it.

## The same test in plain code

In any stack, the test looks like this. The model is real, because a prompt or model change is what you are testing. The tools are answered from a recording, so the test never touches a real system and gets the same tool answers every time.

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgent } from "./agent.mjs";          // your agent loop
import { callModel } from "./model.mjs";          // your real model call

// Tool answers recorded from a good run. A call that is not in the recording fails the test.
const recorded = {
  'get_order {"order_id":"A-1001"}': { item: "headphones", status: "shipped", tracking: "TRK-7731" },
  'track_shipment {"tracking":"TRK-7731"}': { carrier: "Example Post", eta: "Thursday" },
};
const calls = [];
const tool = (name, description, inputSchema) => ({
  name, description, inputSchema,
  run: async (args) => {
    calls.push({ name, args });
    const key = `${name} ${JSON.stringify(args)}`;
    if (!(key in recorded)) throw new Error(`not in the recording: ${key}`);
    return recorded[key];
  },
});

test("tracks the parcel and gives the delivery day", async () => {
  const tools = [
    tool("get_order", "Look up one order by id.", { type: "object", properties: { order_id: { type: "string" } } }),
    tool("track_shipment", "Look up a shipment.", { type: "object", properties: { tracking: { type: "string" } } }),
  ];
  const { answer } = await runAgent(callModel, tools, "Where is my order A-1001?", 6);

  assert.deepEqual(calls.map((c) => c.name), ["get_order", "track_shipment"]);
  assert.equal(calls[0].args.order_id, "A-1001");
  assert.ok(calls.length <= 3, "no extra tool calls");
  assert.match(answer, /thursday/i);
});
```

A few things to notice:

- **The recording is the mock.** It was not written by hand; it came from a run that went well. A hand-written mock tests your idea of the tool, a recording tests the tool as it was.
- **An unknown call is not guessed.** If the changed agent asks for something the recording does not have, the test cannot know what the real tool would have said. Treat that as "inconclusive", not as a pass, and record the case again once you have checked the new behaviour is right.
- **One run may not be enough.** A model can take another path on the next try. Running each case a few times and requiring all of them to pass catches a flaky case before users do ([pass@k and pass^k](/learn/testing/agent-evals#pass-k-and-pass-k)).

## Where unit tests still belong

Evals do not replace unit tests. Most of an agent system is ordinary code, and ordinary tests are faster and cheaper for it:

- **The tools themselves.** `get_order` returns the right order and a clear error for a bad id. No model needed.
- **The loop.** With a fake model that follows fixed rules, you can test that the loop stops at the step limit, adds an error result for an unknown tool, and ties each result to its call. The [agent loop in code](/learn/agents/agent-loop-in-code) guide does exactly that.
- **Parsing and formatting** around the model: schemas, output parsers, templates.
- **Rules and limits**: that a deny rule refuses a call, that a budget stops a run.

Use unit tests where the answer is exact, and evals where the model decides.

## Behaviour tests in L2M

In L2M, the pieces above are built in, and optional:

- **Recording.** In the editor, **Record MCP calls** makes the next runs keep a cassette of their MCP traffic and a tape of their model calls. On the Runs page, **Save as golden** keeps a finished run as a <Term id="golden-run">golden run</Term>: its input, every node's result and its tool calls ([golden runs](/product/golden-runs)).
- **Replay.** A <Term id="replay">replay</Term> runs a changed workflow against a golden run. Models run live by default; MCP calls are answered from the cassette, and a call the recording cannot answer makes the result inconclusive. Writes never run live.
- **Behaviour scorers.** A replay job grades each case with scorers ([golden sets](/product/golden-sets#scorers)). `tool_sequence` compares tool calls with the golden run's or a listed sequence, in `exact`, `subsequence`, `set` or `superset_allowed` mode, optionally checks arguments, and can list `forbiddenTools`. `contains` and `regex` check key facts in the output, `status` checks how the run ended, and `budget` checks cost, tokens and latency against limits or against the golden run.
- **Repeats.** A job can run each case up to five times and require all, a majority or any of the repeats to pass; a case whose repeats disagree is marked flaky.
- **CI.** `l2m replay run --set <id> --file <workflow.json>` exits 0 when every case passed, 1 on a regression and 4 when a case was inconclusive ([CI for AI agents](/guides/ci-for-ai-agents)).

## Further reading

- [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) (Anthropic engineering): tasks, graders, transcripts and pass rates
- Related guides: [Regression testing agents](/learn/testing/regression-testing-agents), [Agent evals](/learn/testing/agent-evals), [Testing MCP tool calls](/learn/testing/testing-mcp-tools), [Release gates](/learn/testing/release-gates)
- In L2M: [Golden runs](/product/golden-runs), [Golden sets and scorers](/product/golden-sets), [Testing MCP workflows](/product/testing-mcp-workflows)
