---
title: "Prompt engineering vs context engineering"
sidebarTitle: "Prompt vs context engineering"
description: "Prompt engineering words the instructions; context engineering chooses everything a model sees on a call. Assemble one under a token budget."
level: beginner
about: context-engineering
related: [context-engineering, context-window, few-shot-prompting, tool-calling, rag, token-llm]
---

# Prompt engineering vs context engineering

Prompt engineering is writing the instructions well: what the task is, the rules, the format of the answer. <Term id="context-engineering">Context engineering</Term> is deciding everything the model sees on a call, of which the instructions are one part: the system prompt, examples, retrieved documents, tool definitions, tool results and the conversation so far. A prompt is written once and reused; a context is built again for every call, from whatever is available, under a limit. Good instructions in a context full of the wrong material still give a wrong answer.

## Two definitions

**Prompt engineering** is about the words of the instructions. Provider guides cover it in detail: be clear and direct, say what format you want, give the reason behind a rule, separate instructions from data (for example with XML tags), and show examples ([Anthropic prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices), [OpenAI prompt engineering guide](https://developers.openai.com/api/docs/guides/prompt-engineering)).

**Context engineering** is about the whole input. Anthropic's engineering team defines context as "the set of tokens included when sampling from a large-language model", and context engineering as curating and maintaining the best set of those tokens during inference. They call it "the natural progression of prompt engineering", and point out that, unlike the one-off task of writing a prompt, it is iterative: the choice is made again each time the model gets new input ([Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).

The reason it matters is that the <Term id="context-window">context window</Term> is limited, and filling it is not free. The same post says context "must be treated as a finite resource with diminishing marginal returns", describes models as having an "attention budget", and names "context rot": as the context grows, the model recalls what is in it less accurately.

## What is in a context

On a typical call, the model sees all of these at once. It has no memory between calls, so anything it needs must be in this list.

| Part | Who writes it | Changes per call? |
|---|---|---|
| System prompt (instructions, rules, format) | You | Rarely |
| Examples of input and wanted output | You | Rarely |
| Tool definitions (name, description, input schema) | You or an MCP server | When tools change |
| Retrieved documents | A search over your data | Every call |
| Tool results | Your tools | Every step of an agent |
| Conversation history | The user and the model | Every turn |
| The current question | The user | Every call |

Prompt engineering works on the first two rows. Context engineering decides all seven: which parts to include, in what order, how much of each, and what to drop when they do not fit.

## Side by side

| | Prompt engineering | Context engineering |
|---|---|---|
| Question it answers | How should the instructions be worded? | What should the model see on this call? |
| Unit of work | A prompt template | A function that builds the input |
| When it happens | At design time | At run time, on every call |
| Typical changes | Clearer rules, a format spec, an example | Retrieval, ranking, trimming, summarising, tool selection |
| Typical failure | The model misreads the task | The model lacks a fact, or drowns in irrelevant ones |
| Limit it works against | Ambiguity | The context window and the cost per token |

## Assembling a context in code

Context engineering is easiest to see as a function. This one takes the parts, a token budget, and returns the messages to send and a list of what it left out. The instructions, the tool definitions and the question are always sent. Then it adds, in order of priority, the examples, the most relevant documents, and as much recent history as fits.

The token counts here are a rough estimate (about four characters per token). Real counts depend on the model's tokenizer; providers offer token-counting endpoints or libraries for exact numbers.

```js
// context.mjs: assemble the context for one model call from parts, under a token budget.
// Run: node context.mjs
// Token counts are a rough estimate (about 4 characters per token), not a real tokenizer.

const roughTokens = (text) => Math.ceil(text.length / 4);

function assembleContext({ system, tools, examples, documents, history, question }, budget, minScore = 0.5) {
  // Always sent: the instructions, the tool definitions and the question itself.
  const toolText = JSON.stringify(tools);
  let used = roughTokens(system) + roughTokens(toolText) + roughTokens(question);
  const trimmed = [];

  // Then, in order of priority: examples, the best documents, the newest history.
  const keptExamples = [];
  for (const ex of examples) {
    const cost = roughTokens(ex.input) + roughTokens(ex.output);
    if (used + cost > budget) { trimmed.push(`example "${ex.input}"`); continue; }
    keptExamples.push(ex); used += cost;
  }
  const keptDocs = [];
  for (const doc of [...documents].sort((a, b) => b.score - a.score)) {
    if (doc.score < minScore) { trimmed.push(`document ${doc.id} (score ${doc.score}, below ${minScore})`); continue; }
    const cost = roughTokens(doc.text);
    if (used + cost > budget) { trimmed.push(`document ${doc.id} (no room)`); continue; }
    keptDocs.push(doc); used += cost;
  }
  const keptHistory = [];
  let full = false;
  for (const turn of [...history].reverse()) {           // newest first; once full, drop everything older
    const cost = roughTokens(turn.content);
    if (full || used + cost > budget) { full = true; trimmed.push(`history: ${turn.role} "${turn.content.slice(0, 24)}..."`); continue; }
    keptHistory.unshift(turn); used += cost;
  }

  const docBlock = keptDocs.map((d) => `<document id="${d.id}">\n${d.text}\n</document>`).join("\n");
  const exampleBlock = keptExamples.map((e) => `<example>\nQ: ${e.input}\nA: ${e.output}\n</example>`).join("\n");
  const messages = [
    { role: "system", content: [system, exampleBlock].filter(Boolean).join("\n\n") },
    ...keptHistory,
    { role: "user", content: [docBlock, question].filter(Boolean).join("\n\n") },
  ];
  return { messages, tools, used, trimmed };
}

const parts = {
  system: "You answer questions about the Example Co. refund policy. Cite the document id you used. If the documents do not answer, say so.",
  tools: [{ name: "get_order", description: "Look up one order by id.", inputSchema: { type: "object", properties: { order_id: { type: "string" } }, required: ["order_id"] } }],
  examples: [{ input: "Can I return a gift card?", output: "No. Gift cards cannot be returned [policy-3]." }],
  documents: [ // retrieved passages with a relevance score; .repeat(3) just makes them longer
    { id: "policy-1", score: 0.91, text: "Refunds: items can be returned within 30 days of delivery for a full refund to the original payment method. ".repeat(3) },
    { id: "policy-2", score: 0.74, text: "Damaged items: report damage within 7 days with a photo; we send a replacement or a refund. ".repeat(3) },
    { id: "faq-9", score: 0.42, text: "Shipping times: standard delivery takes 3 to 5 working days; express takes 1 to 2. ".repeat(3) },
  ],
  history: [
    { role: "user", content: "Hi, I bought headphones last month and they arrived on the 2nd." },
    { role: "assistant", content: "Thanks. What would you like to do with the order?" },
    { role: "user", content: "I am not sure yet, I might keep them, I need to think about the colour." },
    { role: "assistant", content: "No problem. Tell me when you have decided." },
  ],
  question: "How long do I have to return them?",
};

for (const budget of [400, 280]) {
  const { messages, used, trimmed } = assembleContext(parts, budget);
  console.log(`budget ${budget}: about ${used} tokens, ${messages.length} messages`);
  console.log(`  trimmed: ${trimmed.length ? "\n    - " + trimmed.join("\n    - ") : "nothing"}`);
}
```

Running `node context.mjs` with Node.js 24 prints:

```text
budget 400: about 309 tokens, 6 messages
  trimmed: 
    - document faq-9 (score 0.42, below 0.5)
budget 280: about 280 tokens, 4 messages
  trimmed: 
    - document faq-9 (score 0.42, below 0.5)
    - history: assistant "Thanks. What would you l..."
    - history: user "Hi, I bought headphones ..."
```

What the output shows:

- **Relevance comes before room.** The shipping FAQ is dropped in both runs because its score is below the cut-off, not because it did not fit. Sending a weak match costs tokens and gives the model something wrong to quote.
- **History is cut from the oldest end, as a block.** Once one turn does not fit, everything older goes too, so the model never sees a conversation with a hole in the middle.
- **The trimmed turn held the fact the question needs.** At 280 tokens, the first message, "they arrived on the 2nd", is gone. The model can quote the 30-day rule but cannot say when the 30 days end. This is the typical context-engineering bug: every rule worked, and the answer is still worse. The fix is not a better prompt. It is keeping that fact, for example by summarising old turns into a short note ("delivered on the 2nd") instead of dropping them, or by letting the model look up the order with the `get_order` tool.
- **The examples and tools are part of the budget.** A long tool list or many examples leave less room for documents and history.

## Techniques for long-running work

The Anthropic post describes several ways to keep the context useful when an agent runs for many steps ([Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)):

- **Just-in-time retrieval.** Keep light references (file paths, stored queries, links) and let the agent load the content with tools when it needs it, instead of loading everything up front.
- **Compaction.** When a conversation nears the window limit, summarise it and continue in a new window from the summary.
- **Structured note-taking.** The agent writes notes outside the context window and reads them back later.
- **Sub-agents.** Specialised agents do focused tasks in clean context windows and return short summaries to a lead agent ([supervisor and workers](/learn/agents/supervisor-and-workers)).

The same post names "bloated tool sets that cover too much functionality" as a common failure. Every tool definition sits in the context on every call ([too many tools](/learn/agents/too-many-tools)).

## Which to use when

You need both; the question is where the problem is.

- **The model misunderstands the task, or answers in the wrong format** even when it has all the facts: work on the prompt. Make the rules explicit, give the reason for each, and add an example ([zero-shot vs few-shot prompting](/learn/effective-ai/zero-shot-vs-few-shot-prompting)).
- **The model is missing a fact, quotes the wrong document, or gets worse as a conversation grows**: work on the context. Check what was actually sent on the failing call, not what you meant to send.
- **Costs rise with every turn**: the context is growing. Every call resends everything ([controlling LLM costs](/learn/operations/llm-cost-control)), and stable parts at the start can often be cached (<Term id="prompt-caching">prompt caching</Term>).
- **You are choosing between retrieval and pasting whole documents**: that is a context decision with its own trade-offs ([RAG vs long context](/learn/agents/rag-vs-long-context)).

Log the assembled messages for each call. Most context bugs are obvious once you read what the model actually received.

## Further reading

- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (Anthropic engineering)
- [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) (Claude Docs)
- [Prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering) (OpenAI API docs)
- Related guides: [Zero-shot vs few-shot prompting](/learn/effective-ai/zero-shot-vs-few-shot-prompting), [RAG vs long context](/learn/agents/rag-vs-long-context), [Agent memory](/learn/agents/agent-memory), [Too many tools](/learn/agents/too-many-tools), [The agent loop in code](/learn/agents/agent-loop-in-code)
