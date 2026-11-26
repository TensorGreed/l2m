---
title: "Temperature vs top-p: what each sampling setting does"
sidebarTitle: "Temperature vs top-p"
description: "Temperature reshapes a model's next-token probabilities; top-p cuts off the unlikely tail. How both work, in code, and what each provider's API accepts."
level: beginner
about: temperature
related: [temperature, top-p, token-llm, eval]
---

# Temperature vs top-p

A language model picks each next token from a probability distribution. <Term id="temperature">Temperature</Term> reshapes that whole distribution: below 1 it sharpens it towards the likeliest tokens, above 1 it flattens it so unlikely tokens are picked more often. <Term id="top-p">Top-p</Term> (nucleus sampling) leaves the shape alone and cuts off the tail: it keeps only the smallest set of top tokens whose probabilities add up to p. Both trade variety against predictability. Providers document different ranges and defaults, and on some current models these settings are rejected or ignored, so check the API reference for the model you call.

## How a model picks the next token

At each step the model gives every token in its vocabulary a score, called a logit. Softmax turns the scores into probabilities that add up to 1:

```text
p(token) = exp(score / T) / sum over all tokens of exp(score / T)
```

`T` is the temperature. At `T = 1` the scores are used as they are. Dividing by a `T` below 1 stretches the gaps between scores, so the top token takes more of the probability. A `T` above 1 shrinks the gaps, so the probability spreads out. As `T` gets close to 0, nearly all the probability goes to the top token; picking the top token every time is called greedy decoding.

Top-p works after the probabilities are known. Sort the tokens from likeliest down, add their probabilities until the total reaches p, drop the rest, and rescale what is left so it adds up to 1 again. With p = 0.9 the model never picks from the least likely 10% or so of the probability. The method comes from "The Curious Case of Neural Text Degeneration" (Holtzman et al., 2019), which found that "using likelihood as a decoding objective leads to text that is bland and strangely repetitive", and proposed sampling from the nucleus of the distribution: keeping its variety while cutting off the unreliable tail.

## Both in code

This script applies temperature and then top-p to a fixed table of five made-up scores, samples 1,000 tokens with a seeded random generator, and prints the distribution and the counts. Real models score a vocabulary of many thousands of tokens, but the arithmetic is the same.

```js
// sampling.mjs: temperature and top-p (nucleus) on a fixed table of next-token scores (logits).
// Run: node sampling.mjs
// Made-up scores for the next token after "The capital of France is". Real models score a whole vocabulary.
const LOGITS = { Paris: 5.0, Lyon: 3.0, France: 2.5, the: 1.5, Berlin: 0.5 };

function softmax(logits, temperature) {
  const entries = Object.entries(logits).map(([token, z]) => [token, z / temperature]);
  const max = Math.max(...entries.map(([, z]) => z));             // subtract the max for numerical safety
  const exps = entries.map(([token, z]) => [token, Math.exp(z - max)]);
  const sum = exps.reduce((s, [, e]) => s + e, 0);
  return exps.map(([token, e]) => [token, e / sum]).sort((a, b) => b[1] - a[1]);
}

// Keep the smallest set of top tokens whose probabilities add up to at least p, then renormalise.
function topP(probs, p) {
  const kept = [];
  let total = 0;
  for (const [token, prob] of probs) {
    kept.push([token, prob]);
    total += prob;
    if (total >= p) break;
  }
  return kept.map(([token, prob]) => [token, prob / total]);
}

// A small seeded generator (mulberry32), so every run draws the same numbers.
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sample(probs, random) {
  let r = random();
  for (const [token, prob] of probs) { if ((r -= prob) < 0) return token; }
  return probs[probs.length - 1][0];
}

const show = (probs) => probs.map(([t, p]) => `${t} ${(p * 100).toFixed(1)}%`).join(", ");
const SETTINGS = [
  { temperature: 1.0, p: 1.0 },
  { temperature: 0.5, p: 1.0 },
  { temperature: 1.5, p: 1.0 },
  { temperature: 1.0, p: 0.9 },
  { temperature: 1.5, p: 0.9 },
];
for (const { temperature, p } of SETTINGS) {
  const probs = topP(softmax(LOGITS, temperature), p);
  const random = rng(42);
  const counts = Object.fromEntries(probs.map(([t]) => [t, 0]));
  for (let i = 0; i < 1000; i++) { const t = sample(probs, random); counts[t] += 1; }
  console.log(`temperature ${temperature}, top_p ${p}: ${show(probs)}`);
  console.log(`  1000 draws: ${JSON.stringify(counts)}`);
}
```

Running `node sampling.mjs` with Node.js 24 prints:

```text
temperature 1, top_p 1: Paris 79.4%, Lyon 10.8%, France 6.5%, the 2.4%, Berlin 0.9%
  1000 draws: {"Paris":790,"Lyon":116,"France":60,"the":23,"Berlin":11}
temperature 0.5, top_p 1: Paris 97.5%, Lyon 1.8%, France 0.7%, the 0.1%, Berlin 0.0%
  1000 draws: {"Paris":970,"Lyon":21,"France":9,"the":0,"Berlin":0}
temperature 1.5, top_p 1: Paris 62.5%, Lyon 16.5%, France 11.8%, the 6.1%, Berlin 3.1%
  1000 draws: {"Paris":617,"Lyon":166,"France":130,"the":53,"Berlin":34}
temperature 1, top_p 0.9: Paris 88.1%, Lyon 11.9%
  1000 draws: {"Paris":881,"Lyon":119}
temperature 1.5, top_p 0.9: Paris 68.8%, Lyon 18.1%, France 13.0%
  1000 draws: {"Paris":696,"Lyon":169,"France":135}
```

Reading the output:

- **Temperature 0.5** gives "Paris" 97.5% and leaves "Berlin" almost no chance. Nothing is removed, but the tail becomes very unlikely.
- **Temperature 1.5** spreads the probability: "Berlin", a wrong answer, comes up 34 times in 1,000.
- **Top-p 0.9 at temperature 1** keeps only "Paris" and "Lyon". "Berlin" can never be picked, however many times you sample. That is the difference in one line: temperature makes the tail less or more likely, top-p removes it.
- **Both together** interact. At temperature 1.5 the distribution is flatter, so reaching 0.9 takes three tokens instead of two. This script applies temperature first and then top-p; that order is a choice made here, so do not assume a provider does the same.

## Side by side

| | Temperature | Top-p |
|---|---|---|
| What it changes | The shape of the whole distribution | Which tokens are allowed at all |
| Lower value | Sharper: the top token dominates | Fewer tokens kept |
| Higher value | Flatter: more variety, more odd picks | More tokens kept, up to all at 1 |
| Can a very unlikely token be picked? | Yes, with small probability | No, if it falls outside the nucleus |
| Adapts to the model's confidence? | No, the same reshaping every step | Yes: a confident step keeps few tokens, an uncertain one keeps many |
| Origin | Softmax with a temperature term | Holtzman et al., 2019 |

## What each provider documents

These settings are not portable. Each API documents its own ranges and defaults, and some current models no longer take them. As each provider's reference states it:

- **OpenAI** ([Chat Completions API reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)): `temperature` is between 0 and 2, default 1. `top_p` is between 0 and 1, default 1; the reference describes it as "an alternative to sampling with temperature, called nucleus sampling", where 0.1 means only the tokens in the top 10% of probability mass are considered. For each, the reference says: "We generally recommend altering this or `top_p` but not both" (and the same the other way round). It also notes that "parameter support can differ depending on the model used to generate the response, particularly for newer reasoning models", and points to its reasoning guide for the current list.
- **Anthropic** ([Migrating to API version 2026-10-21](https://platform.claude.com/docs/en/api/migration-2026-10-21#sampling-parameters)): in API version `2026-10-21`, a Messages request that sends `temperature`, `top_p` or `top_k` returns a 400 error, even at the default value. Without them, a request samples with the defaults, including a temperature of 1.0. The guide says that models such as Claude 4.7 and later already accept only the defaults, and that on models that accepted other values, such as Claude Sonnet 4.6, a request that lowered temperature loses that effect, with no other setting to replace it.
- **Google Gemini** ([generateContent API reference](https://aistudio.google.com/api-reference/generate-content), `GenerationConfig`): `temperature` can range over [0.0, 2.0], and its default varies by model (see the model's `temperature` attribute from `getModel`). `topP` is "the maximum cumulative probability of tokens to consider when sampling", with a model-specific default. For `temperature`, `topP` and `topK`, the reference says the field "is no longer supported and is silently ignored on Gemini 3.6 Flash and newer models".

Two consequences. A temperature of 0.2 does not mean the same thing on two providers, and may mean nothing at all on a newer model. And code that forwards a sampling setting to every model can get an error from one provider and be silently ignored by another, so test a setting on the model you actually use.

## Low temperature is not a repeatability guarantee

A low temperature makes the likeliest answer more likely; it does not make a model a pure function. OpenAI's reference for its `seed` parameter, which exists to make sampling repeatable (and is now marked deprecated and in beta), says the system "will make a best effort to sample deterministically" and that "determinism is not guaranteed". If your tests depend on the exact words a model returns, they will break sooner or later. Test the behaviour that matters instead: the fields, the labels, the tool calls ([evals vs unit tests](/learn/testing/evals-vs-unit-tests)), and for exact repeatability in CI, replay recorded answers rather than calling the model ([regression testing agents](/learn/testing/regression-testing-agents)).

## Which to use when

- **Leave both at the default** unless you have measured a reason to change them. On some current models you have no choice.
- **For extraction, classification and other tasks with one right answer**, where the model accepts it, a lower temperature reduces variety. Enforce the output format with a schema and a validator as well ([JSON mode vs structured outputs](/learn/effective-ai/json-mode-vs-structured-outputs)); sampling settings do not guarantee a format.
- **For brainstorming or varied drafts**, the default or a slightly higher temperature gives more variety, with more off-target picks.
- **Change one, not both.** OpenAI's reference recommends it, and the code above shows why: the two interact, so changing both makes the effect hard to read.
- **Compare settings on a fixed set of inputs**, several runs each, and look at the spread of results, not one lucky answer ([agent evals](/learn/testing/agent-evals)).

## Further reading

- [The Curious Case of Neural Text Degeneration](https://arxiv.org/abs/1904.09751) (arXiv), Holtzman et al., 2019: nucleus (top-p) sampling
- [Create chat completion: temperature, top_p, seed](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) (OpenAI API reference)
- [Migrating to API version 2026-10-21: sampling parameters are removed](https://platform.claude.com/docs/en/api/migration-2026-10-21#sampling-parameters) (Claude Docs)
- [generateContent: GenerationConfig](https://aistudio.google.com/api-reference/generate-content) (Gemini API reference)
- Related guides: [Zero-shot vs few-shot prompting](/learn/effective-ai/zero-shot-vs-few-shot-prompting), [JSON mode vs structured outputs](/learn/effective-ai/json-mode-vs-structured-outputs), [Evals vs unit tests](/learn/testing/evals-vs-unit-tests)
