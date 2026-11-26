---
title: "EU AI Act risk categories: the four levels explained"
sidebarTitle: "EU AI Act risk levels"
description: "The EU AI Act's risk levels: prohibited practices, high-risk systems, transparency duties and minimal risk, plus the separate GPAI track and the key dates."
level: intermediate
about: eu-ai-act
related: [eu-ai-act, nist-ai-rmf, iso-42001, human-in-the-loop, audit-log]
---

# EU AI Act risk categories

The <Term id="eu-ai-act">EU AI Act</Term> (Regulation (EU) 2024/1689) sorts AI systems by what they are used for. A short list of practices is banned outright (Article 5). Systems used in sensitive areas, such as hiring, credit or critical infrastructure, are high-risk and carry the heaviest duties (Article 6 with Annexes I and III). Systems that talk to people or generate content have transparency duties (Article 50). Everything else, such as a spam filter, is minimal risk and gets no specific rules. General-purpose AI models, the large models other systems are built on, follow a separate track (Chapter V).

This page explains the structure of the Act. It is not legal advice.

## How the Act classifies

The classification follows the use, not the technique. The same model can sit in a minimal-risk spam filter and in a high-risk CV screener. What decides the level is the system's intended purpose and the setting it is used in.

The duties also depend on your role. The Act separates the **provider**, who develops an AI system or has it developed and places it on the market under its own name (Article 3(3)), from the **deployer**, who uses an AI system under its authority (Article 3(4)). A company that builds a hiring tool is its provider; an employer that uses the tool is a deployer. Most duties for high-risk systems fall on providers, with a smaller set on deployers.

## The four levels

### Unacceptable risk: prohibited practices (Article 5)

Article 5(1) lists practices that may not be placed on the market, put into service or used. Among them:

- manipulative or deceptive techniques that materially distort a person's behaviour and cause, or are reasonably likely to cause, significant harm (point (a));
- exploiting vulnerabilities due to age, disability or a social or economic situation (point (b));
- social scoring that leads to unjustified or unrelated detrimental treatment (point (c));
- predicting the risk that a person will commit a crime based solely on profiling or personality traits (point (d));
- building facial recognition databases by untargeted scraping of images from the internet or CCTV (point (e));
- inferring emotions of a person in the workplace or in education, except for medical or safety reasons (point (f));
- biometric categorisation to infer race, political opinions, trade union membership, religious or philosophical beliefs, sex life or sexual orientation (point (g));
- real-time remote biometric identification in public spaces for law enforcement, apart from narrow exceptions (point (h)).

The 2026 amendment described below adds two more: systems that generate or manipulate realistic intimate images of an identifiable person without their explicit consent, and systems that generate child sexual abuse material (new points (ba) and (bb)).

### High risk (Article 6, Annexes I and III)

There are two routes into the high-risk category.

- **Article 6(1), products.** The AI system is a safety component of a product, or is itself a product, covered by the EU product laws listed in Annex I (machinery, toys, medical devices and others), and that product needs a third-party conformity assessment.
- **Article 6(2), listed uses.** The system falls in one of the areas listed in Annex III: biometrics, critical infrastructure, education, employment, access to essential private and public services (for example creditworthiness, or life and health insurance pricing), law enforcement, migration and border control, and the administration of justice and democratic processes.

Article 6(3) lets an Annex III system escape the category when it does not pose a significant risk of harm, for example because it performs only a narrow procedural task or a preparatory task. That exit is closed when the system profiles natural persons: then it is always high-risk. A provider who relies on Article 6(3) must document its assessment before placing the system on the market (Article 6(4)).

High-risk systems carry the requirements in Chapter III, Section 2, such as risk management, data governance, technical documentation, record-keeping, human oversight, and accuracy and robustness, plus the provider and deployer duties in Section 3.

### Transparency obligations (Article 50)

Article 50 applies on top of the other levels, not instead of them:

- **50(1)** Providers must design systems that interact with people so that people are told they are talking to an AI system, unless that is obvious from the context.
- **50(2)** Providers of systems that generate synthetic audio, images, video or text must mark the outputs in a machine-readable format, so that they are detectable as AI-generated.
- **50(3)** Deployers of emotion recognition or biometric categorisation systems must inform the people exposed to them.
- **50(4)** Deployers of systems that produce deep fakes must disclose that the content is artificial, as must deployers that publish AI-generated text to inform the public on matters of public interest, unless it was reviewed by a person who holds editorial responsibility.

### Minimal risk

"Minimal risk" is not a term the Act defines. It is the European Commission's name for everything left over: the Commission's AI Act page says the Act "does not introduce rules for AI that is deemed minimal or no risk", and gives AI-enabled video games and spam filters as examples. Two things still reach these systems: the AI literacy duty in Article 4, which applies to all providers and deployers, and voluntary codes of conduct (Article 95).

## General-purpose AI models: a separate track

Chapter V regulates the **models**, not the systems built on them. A general-purpose AI model is one that "displays significant generality and is capable of competently performing a wide range of distinct tasks" and can be integrated into many downstream systems (Article 3(63)). Its providers must keep technical documentation, give information to the providers who build on the model, have a copyright policy and publish a summary of the training content (Article 53). Models with systemic risk carry more duties (Article 55). A model is presumed to have systemic risk when the compute used to train it is greater than 10^25 floating point operations (Article 51(2)).

If you call a hosted model through an API and build an application on it, the model provider is the one with Chapter V duties. If you fine-tune or modify the model, your duties as a model provider are limited to that change (Recital 109). Your application is an AI system, and it is classified by its own use under the four levels above.

## Key dates

The Act was published in the Official Journal on 12 July 2024 and entered into force on the twentieth day after that, 1 August 2024 (Article 113). Article 113 then staggers when its parts apply. Regulation (EU) 2026/1744, the "Digital Omnibus on AI", amended Article 113 and moved the high-risk dates. It was published on 24 July 2026 and entered into force on 27 July 2026.

| What | Original Article 113 | As amended by Regulation (EU) 2026/1744 |
|---|---|---|
| Chapters I and II: definitions, AI literacy, prohibited practices | 2 February 2025 | Unchanged; the new prohibitions in Article 5(1)(ba) and (bb) apply from 2 December 2026 |
| Chapter V (general-purpose AI models), governance, penalties (except Article 101, fines for model providers), notified bodies | 2 August 2025 | Unchanged |
| General date of application, including Article 50 transparency | 2 August 2026 | Unchanged |
| High-risk systems under Article 6(2) and Annex III | 2 August 2026 (general date) | 2 December 2027 |
| High-risk systems under Article 6(1) and Annex I | 2 August 2027 | 2 August 2028 |

Two transitional rules matter for existing systems. Providers of general-purpose AI models placed on the market before 2 August 2025 have until 2 August 2027 to comply (Article 111(3)). Providers of generative systems placed on the market before 2 August 2026 have until 2 December 2026 to meet the marking duty in Article 50(2) (Article 111(4), added in 2026).

## Worked example: four AI uses

| Use | Level | The article that decides it |
|---|---|---|
| Support chatbot on a shop website | Transparency | Article 50(1): tell users they are talking to an AI system. Because it generates text, its provider also has the Article 50(2) marking duty. |
| CV-screening tool that ranks applicants | High-risk | Article 6(2) with Annex III point 4(a): systems used "to analyse and filter job applications, and to evaluate candidates". If it profiles applicants, Article 6(3) cannot take it out. |
| Spam filter on a company mailbox | Minimal risk | No Article covers it; the Commission names spam filters as minimal risk. Article 4 AI literacy still applies. |
| Emotion recognition of staff on video calls | Prohibited | Article 5(1)(f): inferring emotions in the workplace, unless for medical or safety reasons. Outside work and education, emotion recognition is high-risk under Annex III point 1(c). |

A first-pass triage can be a short script that asks the questions in the same order the Act does: banned first, then high-risk, then transparency. It only points at the articles to read.

```js
// First-pass EU AI Act triage. A study aid: it only points at the
// articles to read. Real classification needs the full text and, for
// anything close to the line, a lawyer.

const checks = [
  { level: "prohibited", article: "Art. 5(1)(f)",
    test: (u) => u.infersEmotions && ["workplace", "education"].includes(u.setting) && !u.medicalOrSafety },
  { level: "high-risk", article: "Art. 6(1) + Annex I",
    test: (u) => u.safetyComponentOfRegulatedProduct },
  { level: "high-risk", article: "Art. 6(2) + Annex III",
    test: (u) => u.annexIIIArea !== null },
  { level: "transparency", article: "Art. 50(1)",
    test: (u) => u.talksToPeople },
  { level: "transparency", article: "Art. 50(2)",
    test: (u) => u.generatesContent },
];

function triage(use) {
  const hits = checks.filter((c) => c.test(use)).map((c) => `${c.level} (${c.article})`);
  return hits.length ? hits : ["no specific obligations found (minimal risk); Art. 4 AI literacy still applies"];
}

const base = { infersEmotions: false, setting: null, medicalOrSafety: false,
  safetyComponentOfRegulatedProduct: false, annexIIIArea: null,
  talksToPeople: false, generatesContent: false };

const uses = {
  "Support chatbot": { ...base, talksToPeople: true, generatesContent: true },
  "CV-screening tool": { ...base, annexIIIArea: "4(a) employment: recruitment or selection" },
  "Spam filter": { ...base },
  "Emotion recognition at work": { ...base, infersEmotions: true, setting: "workplace" },
};

for (const [name, use] of Object.entries(uses)) {
  console.log(`${name}: ${triage(use).join("; ")}`);
}
```

Save it as `triage.mjs` and run `node triage.mjs`:

```text
Support chatbot: transparency (Art. 50(1)); transparency (Art. 50(2))
CV-screening tool: high-risk (Art. 6(2) + Annex III)
Spam filter: no specific obligations found (minimal risk); Art. 4 AI literacy still applies
Emotion recognition at work: prohibited (Art. 5(1)(f))
```

The script checks only one prohibition and treats every Annex III area as a yes or no. A real assessment reads all of Article 5, each Annex III point, the Article 6(3) exceptions and your role.

## What this means for an AI agent

An agent is classified like any other AI system: by what it does. An agent that answers product questions is a transparency case. The same agent, given tools that rank job applicants or decide on credit, becomes a high-risk system, and the duties follow the use. Two of those duties map onto everyday engineering. Record-keeping (Article 12) asks for automatic logs of events, which is what an [audit trail for agents](/learn/operations/audit-trails-for-agents) provides. Human oversight (Article 14) asks that people can understand, monitor and stop the system, which is where [human-in-the-loop approvals](/learn/agents/human-in-the-loop) fit.

For a voluntary framework and a certifiable standard that cover AI risk more broadly, see [NIST AI RMF vs ISO/IEC 42001](/learn/governance/nist-ai-rmf-vs-iso-42001).

## Further reading

- [Regulation (EU) 2024/1689, the Artificial Intelligence Act](https://eur-lex.europa.eu/eli/reg/2024/1689/oj) (EUR-Lex): Articles 3, 5, 6, 50, 51, 53, 111 and 113, Annexes I and III
- [Regulation (EU) 2026/1744, the Digital Omnibus on AI](https://eur-lex.europa.eu/eli/reg/2026/1744/oj) (EUR-Lex): the amended Article 113 dates and the new Article 5 prohibitions
- [AI Act: regulatory framework for AI](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai) (European Commission): the four risk levels and the timeline
- Related guides: [NIST AI RMF vs ISO/IEC 42001](/learn/governance/nist-ai-rmf-vs-iso-42001), [Audit trails for AI agents](/learn/operations/audit-trails-for-agents), [Human in the loop](/learn/agents/human-in-the-loop), [PII vs personal data](/learn/data-protection/pii-vs-personal-data)
