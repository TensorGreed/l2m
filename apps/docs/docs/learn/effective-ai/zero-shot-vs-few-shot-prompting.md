---
title: "Zero-shot vs few-shot prompting: when examples help"
sidebarTitle: "Zero-shot vs few-shot"
description: "Zero-shot gives a model only instructions; few-shot adds worked examples. Where examples fix format and edge cases, and what they cost in tokens and bias."
level: beginner
about: few-shot-prompting
related: [few-shot-prompting, context-engineering, structured-output, token-llm, eval]
---

# Zero-shot vs few-shot prompting

Zero-shot prompting gives the model only a description of the task. <Term id="few-shot-prompting">Few-shot prompting</Term> adds a few worked examples of input and the wanted output, and the model follows their pattern. Examples are one of the most reliable ways to fix the format of an answer and to settle edge cases the instructions leave open. They cost tokens on every call, and the model copies whatever the examples have in common, including patterns you did not mean to teach.

## Where the terms come from

The terms were set out in the GPT-3 paper, "Language Models are Few-Shot Learners" (Brown et al., 2020). It describes three settings, all done "without any gradient updates or fine-tuning", with the task given purely as text:

- **Few-shot**: the model is given a few demonstrations of the task at inference time, and no weight updates are allowed. The paper typically used 10 to 100 examples, as many as fitted its 2,048-token context window.
- **One-shot**: the same, with only one demonstration, plus a natural-language description of the task.
- **Zero-shot**: no demonstrations, only a natural-language instruction. The paper says it offers "maximum convenience" but is also "the most challenging setting", and notes that some tasks are hard even for people to understand without an example.

Nothing is trained in any of the three. The examples live in the prompt and are sent again on every call. If you want a model's weights to change, that is fine-tuning, a different technique.

## What provider guides say about examples

Current guides recommend far fewer examples than the paper used, and are specific about which ones:

- Anthropic's guide calls examples "one of the most reliable ways to steer Claude's output format, tone, and structure", and recommends 3 to 5. It asks for examples that are relevant (close to the real use case), diverse (covering edge cases, varied enough that the model "doesn't pick up unintended patterns") and structured, wrapped in `<example>` tags so they are not mistaken for instructions ([Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)).
- OpenAI's guide says to "show a diverse range of possible inputs with the desired outputs", and notes that examples are typically given in a `developer` message ([Prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering)).

Both put diversity first. A set of near-identical examples teaches the model that the answer is usually the same.

## Side by side

| | Zero-shot | Few-shot |
|---|---|---|
| What the prompt holds | Instructions only | Instructions and worked examples |
| Tokens per call | Fewer | More, on every call |
| Output format | Follows the description, more loosely | Copies the examples closely |
| Edge cases | Decided by the model's own reading of the rules | Decided the way your examples decided them |
| Risk | Vague or wrongly formatted answers | The model copies the examples' quirks and label balance |
| Upkeep | Edit the instructions | Edit the instructions and keep the examples in line with them |

## Both in code

The task: label a support ticket as `billing`, `bug`, `account` or `other`, so that a program can route it. The zero-shot version sends the instructions and the ticket. The few-shot version puts worked examples between them, each as a user turn followed by the assistant reply we want. One example settles an edge decision the instructions leave open: a refund request for a broken feature counts as billing.

The model here is a stub that returns fixed replies, so the script runs without a key or network. The replies illustrate a common failure; they are not a recording of any real model.

```js
// fewshot.mjs: zero-shot and few-shot message lists for ticket classification, with a stub model.
// Run: node fewshot.mjs
// The stub returns fixed replies so the script runs offline. It is not a real model's behaviour.

const LABELS = ["billing", "bug", "account", "other"];
const INSTRUCTIONS = `Classify the support ticket. Reply with one label only: ${LABELS.join(", ")}.`;
const roughTokens = (messages) => Math.ceil(messages.map((m) => m.content).join("").length / 4); // rough: ~4 chars per token

function zeroShot(ticket) {
  return [
    { role: "system", content: INSTRUCTIONS },
    { role: "user", content: ticket },
  ];
}

// Each example is a worked user turn and the assistant reply we want.
function fewShot(ticket, examples) {
  return [
    { role: "system", content: INSTRUCTIONS },
    ...examples.flatMap((ex) => [
      { role: "user", content: ex.ticket },
      { role: "assistant", content: ex.label },
    ]),
    { role: "user", content: ticket },
  ];
}

const EXAMPLES = [
  { ticket: "I was charged twice for March.", label: "billing" },
  { ticket: "The export button does nothing in Firefox.", label: "bug" },
  { ticket: "Please change the email on my login.", label: "account" },
  // An edge decision the instructions alone do not settle: a refund request for a failed feature is billing.
  { ticket: "The sync broke all week, I want my money back for it.", label: "billing" },
];

// Stub model: a fixed reply per prompt shape, standing in for a real call.
async function stubModel(messages) {
  const hasExamples = messages.some((m) => m.role === "assistant");
  return hasExamples ? "billing" : "This looks like a bug report, though the customer also wants a refund.";
}

// The parser the rest of the program depends on: exactly one known label, or nothing.
const parseLabel = (reply) => (LABELS.includes(reply.trim().toLowerCase()) ? reply.trim().toLowerCase() : null);

const ticket = "Reports have failed since Monday and I want a refund for this month.";
for (const [name, messages] of [["zero-shot", zeroShot(ticket)], ["few-shot", fewShot(ticket, EXAMPLES)]]) {
  const reply = await stubModel(messages);
  console.log(`${name}: ${messages.length} messages, about ${roughTokens(messages)} tokens`);
  console.log(`  reply: ${JSON.stringify(reply)} -> label: ${parseLabel(reply) ?? "unparseable"}`);
}

// Examples carry their own bias: count the labels they show.
const counts = Object.fromEntries(LABELS.map((l) => [l, EXAMPLES.filter((e) => e.label === l).length]));
console.log("labels in the examples:", counts);
```

Running `node fewshot.mjs` with Node.js 24 prints:

```text
zero-shot: 2 messages, about 39 tokens
  reply: "This looks like a bug report, though the customer also wants a refund." -> label: unparseable
few-shot: 10 messages, about 85 tokens
  reply: "billing" -> label: billing
labels in the examples: { billing: 2, bug: 1, account: 1, other: 0 }
```

Three things to take from it. The token counts are rough (four characters per token), but the ratio is the point: four short examples more than doubled the input, and they are paid for on every ticket. The parser accepts one label and nothing else, so a helpful sentence is as useless to the program as a wrong label. And the examples have a balance of their own: half of them are `billing` and none is `other`.

## Where few-shot helps

- **Format.** If a program reads the answer, examples show the exact shape: one word, a fixed set of fields, no preamble. For JSON, combine examples with a schema the provider enforces, where one is available ([JSON mode vs structured outputs](/learn/effective-ai/json-mode-vs-structured-outputs)).
- **Edge decisions.** Instructions cannot list every case. An example that shows how you decided a borderline one (a refund for a broken feature is billing; a login failure after a payment is account) passes on a decision that would be long to write as a rule.
- **Tone and length.** Two or three replies in the voice you want often say more than a paragraph describing it.
- **A domain the model does not know well**, such as internal codes or a house style for summaries.

## What few-shot costs

- **Tokens on every call.** Examples are part of the input each time. With many calls or long examples, this is a real cost and a share of the context window you cannot use for documents or history ([prompt vs context engineering](/learn/effective-ai/prompt-engineering-vs-context-engineering)). Stable examples at the start of the prompt are good candidates for <Term id="prompt-caching">prompt caching</Term>.
- **Copied bias.** The model picks up whatever the examples share. If most of them carry one label, or all are short, or all mention the same product, expect more of the same in the answers. Balance the labels, vary the length and wording, and include at least one example of every outcome you want to see, including the rare one.
- **Examples that go stale.** When the rules change and an example does not, the model follows the example. Keep examples in the same file as the instructions and review them together.
- **Leaking content.** Real tickets used as examples are sent to the provider on every call. Write synthetic ones, or strip personal details first.

## Which to use when

- **Start zero-shot** with clear instructions and a strict output check. Many tasks need nothing more.
- **Add examples when the format drifts** or a known edge case is decided differently from run to run. Add the example that covers that case, not ten more of the easy ones.
- **Keep the examples diverse and balanced**, and few. Provider guides suggest a handful, not dozens.
- **Measure, do not guess.** Run the same set of real inputs with and without the examples and compare: accuracy on the edge cases, how often the output parses, and tokens per call ([agent evals](/learn/testing/agent-evals)).
- **If the output must be machine-readable**, examples alone are not a guarantee. Validate every reply.

## Further reading

- [Language Models are Few-Shot Learners](https://arxiv.org/abs/2005.14165) (arXiv), Brown et al., 2020; the three settings are defined in Section 2
- [Prompting best practices: use examples effectively](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) (Claude Docs)
- [Prompt engineering: few-shot learning](https://developers.openai.com/api/docs/guides/prompt-engineering) (OpenAI API docs)
- Related guides: [Prompt engineering vs context engineering](/learn/effective-ai/prompt-engineering-vs-context-engineering), [JSON mode vs structured outputs](/learn/effective-ai/json-mode-vs-structured-outputs), [Support ticket triage agent](/learn/use-cases/support-ticket-triage-agent), [Agent evals](/learn/testing/agent-evals)
