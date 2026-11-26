---
title: "PII vs personal data: what is the difference?"
sidebarTitle: "PII vs personal data"
description: "PII is a US term from NIST guidance; personal data is the GDPR's legal term, and it is wider. Definitions, examples and why it matters for AI logs."
level: beginner
about: personal-data
related: [personal-data, pii, pseudonymisation, anonymisation, data-retention, right-to-erasure]
---

# PII vs personal data

<Term id="pii">PII</Term> (personally identifiable information) is a US term. Its best-known definition comes from NIST guidance for federal agencies, and US laws and contracts each define it their own way. <Term id="personal-data">Personal data</Term> is the legal term of the EU's General Data Protection Regulation (GDPR): any information relating to a person who is identified or identifiable, directly or indirectly. The GDPR's notion is the wider one in practice. It covers online identifiers such as IP addresses and cookie IDs, data that only identifies someone when combined with other data, and pseudonymised data. If you build for EU users, "is it personal data?" is the question that counts, and the answer is often yes.

This page explains concepts. It is not legal advice.

## Two definitions

**PII, in NIST SP 800-122 (April 2010).** NIST's *Guide to Protecting the Confidentiality of Personally Identifiable Information* uses this definition, taken from a US Government Accountability Office report:

> PII is "any information about an individual maintained by an agency, including (1) any information that can be used to distinguish or trace an individual's identity, such as name, social security number, date and place of birth, mother's maiden name, or biometric records; and (2) any other information that is linked or linkable to an individual, such as medical, educational, financial, and employment information."

The guide separates *linked* information (already joined to other data about the person) from *linkable* information (could be joined, for example from public records or a search engine). It is written for US federal agencies and is guidance, not a law.

**Personal data, in GDPR Article 4(1).** The regulation defines it as:

> "any information relating to an identified or identifiable natural person ('data subject'); an identifiable natural person is one who can be identified, directly or indirectly, in particular by reference to an identifier such as a name, an identification number, location data, an online identifier or to one or more factors specific to the physical, physiological, genetic, mental, economic, cultural or social identity of that natural person"

Two recitals explain how far that reaches:

- **Recital 26** says that to decide whether a person is identifiable, "account should be taken of all the means reasonably likely to be used, such as singling out, either by the controller or by another person". It adds that pseudonymised data, which could be attributed to a person with additional information, is still information on an identifiable person. Only truly anonymous information falls outside the GDPR.
- **Recital 30** says people "may be associated with online identifiers provided by their devices, applications, tools and protocols, such as internet protocol addresses, cookie identifiers or other identifiers such as radio frequency identification tags", and that these can be combined to build profiles and identify them.

## Why the GDPR's notion is broader

The NIST definition is wide too: it includes linkable data, and it even lists IP addresses that consistently link to a person. The differences lie elsewhere.

- **Law, not guidance.** Personal data is a legal category with duties attached. PII has no single legal meaning in the US; each statute or contract that uses it sets its own scope.
- **"Any information relating to" a person.** The definition is not limited to the fields that identify someone. What they bought, what they wrote in a support ticket, or what a system concluded about them can all relate to them.
- **Identifiable by anyone, by reasonable means.** Recital 26 asks whether the controller *or another person* could identify the person with means reasonably likely to be used. Data that you cannot link back yourself may still be personal data.
- **Singling out is enough.** You do not need a name. If a record lets you pick out one individual from everyone else, that person is identifiable.
- **Pseudonymised data stays in scope.** A hashed or tokenised identifier is still personal data while someone can reverse or link it ([anonymisation vs pseudonymisation](/learn/data-protection/anonymization-vs-pseudonymization)).

On top of the general definition, **Article 9** names special categories of personal data whose processing is prohibited unless an exception applies: data revealing racial or ethnic origin, political opinions, religious or philosophical beliefs, or trade union membership; genetic data; biometric data used to uniquely identify a person; health data; and data about a person's sex life or sexual orientation.

## Side by side

| | PII (NIST SP 800-122) | Personal data (GDPR) |
|---|---|---|
| Where the term comes from | US federal guidance; US laws each define their own | EU law: Regulation (EU) 2016/679, Article 4(1) |
| Core test | Can it distinguish or trace a person, or is it linked or linkable to one? | Does it relate to an identified or identifiable person? |
| Who could identify | Considers linking with other sources | The controller or another person, with means reasonably likely to be used (Recital 26) |
| Online identifiers | IP or MAC addresses that consistently link to a person or a small, well-defined group are listed | Named in Article 4(1); IP addresses and cookie IDs named in Recital 30 |
| Pseudonymised data | Discussed under de-identification, where records may keep a code that allows re-identification | Still personal data (Recital 26) |
| Sensitive data | Low, moderate or high confidentiality impact levels, set by each organisation | Special categories with a default prohibition (Article 9) |

## Examples

| Value | Personal data under the GDPR? | Why |
|---|---|---|
| `ann.lee@example.com` | Yes | It identifies a person directly. A shared mailbox such as `support@` may not, unless it points to one person. |
| An IP address in a request log | Usually | An online identifier (Recital 30). The provider or another party can often link it to a subscriber. |
| A cookie ID | Usually | Named in Recital 30. It singles out one browser, and usually one user, across visits. |
| A SHA-256 hash of an email | Yes | Anyone with a list of emails can hash them and compare. It is pseudonymised, not anonymous. |
| "Head of Finance, Example Ltd" | Often | It names no one, but if one person holds that job, they are identified indirectly. |
| "Users in Leeds: 4,812" | No, if the count is large | An aggregate that cannot single anyone out. Small counts can. |

## How combining fields singles someone out

No single field below is a name. Together they can be. This toy example counts how many rows share each combination of quasi-identifiers (fields that are not identifiers on their own). The smallest group size is the dataset's *k*: if k is 1, at least one row belongs to exactly one person. The data is invented.

```python
# Toy data: twelve invented support-log rows, no names, no emails.
# Count how many rows share each combination of quasi-identifiers.
from collections import Counter

rows = [
    # (postcode area, birth year, job title)
    ("LS6", 1988, "nurse"),
    ("LS6", 1988, "nurse"),
    ("LS6", 1991, "teacher"),
    ("LS6", 1991, "teacher"),
    ("LS6", 1991, "teacher"),
    ("LS7", 1975, "nurse"),
    ("LS7", 1975, "nurse"),
    ("LS7", 1988, "data engineer"),
    ("LS7", 1988, "nurse"),
    ("LS8", 1962, "pilot"),
    ("LS8", 1962, "teacher"),
    ("LS8", 1970, "nurse"),
]

def smallest_group(columns):
    groups = Counter(tuple(r[i] for i in columns) for r in rows)
    k = min(groups.values())
    unique = [g for g, n in groups.items() if n == 1]
    return k, unique

for label, cols in [("postcode", [0]), ("postcode + year", [0, 1]),
                    ("postcode + year + job", [0, 1, 2])]:
    k, unique = smallest_group(cols)
    print(f"{label:24} k={k}  rows that stand alone: {unique}")
```

Run it with `python3 quasi_ids.py`:

```text
postcode                 k=3  rows that stand alone: []
postcode + year          k=1  rows that stand alone: [('LS8', 1970)]
postcode + year + job    k=1  rows that stand alone: [('LS7', 1988, 'data engineer'), ('LS7', 1988, 'nurse'), ('LS8', 1962, 'pilot'), ('LS8', 1962, 'teacher'), ('LS8', 1970, 'nurse')]
```

With the postcode area alone, every row hides among at least three. Add the birth year and one person stands alone. Add the job title and five of the twelve rows describe exactly one person each. Anyone who knows that a nurse born in 1970 lives in LS8 can now read that person's support history. This is what Recital 26 means by singling out, and it is why removing names does not make a log anonymous.

## Where personal data hides in an AI system

An AI application copies text from step to step, and every copy can hold personal data:

- **Prompts and chat history.** Users type names, addresses and health details. Retrieved documents add more.
- **Tool arguments and results.** A lookup by email sends the email to a tool, and the result often brings back more about the person than the user typed.
- **Logs and traces.** Request logs and tracing spans record prompts, arguments and IP addresses, often for longer than the application keeps its own data.
- **Agent memory and caches.** Facts saved about a user persist across sessions ([agent memory](/learn/agents/agent-memory)).
- **Embeddings.** A vector computed from a sentence about a person still relates to that person, and it is usually stored next to the source text or a user ID that links it back.
- **Evaluation and test data.** Real conversations copied into test sets bring their personal data with them.

The practical consequence is that the usual GDPR questions (what is the purpose, how long is it kept, who can see it, how do you delete one person's data) apply to each of these stores, not only to the user table. [AI data retention and erasure](/learn/operations/ai-data-retention-and-erasure) covers retention and deletion, and [keeping personal data out of prompts](/learn/security/sensitive-data-in-prompts) covers reducing what reaches the model.

## Which term to use when

- **Working with EU or UK users, or EU law generally:** use "personal data" and the GDPR test. Assume identifiers, IDs and free text are in scope unless you can show otherwise.
- **US federal work or a US contract:** use the definition of PII that the contract or statute gives; NIST SP 800-122 is NIST's guidance for federal agencies.
- **Engineering and logging rules:** design for the wider notion. Data you treat as personal data under the GDPR's definition usually covers what narrower definitions include.

## Further reading

- [Regulation (EU) 2016/679, the General Data Protection Regulation](https://eur-lex.europa.eu/eli/reg/2016/679/oj) (EUR-Lex): Article 4(1), Article 9, Recitals 26 and 30
- [NIST SP 800-122, Guide to Protecting the Confidentiality of PII](https://csrc.nist.gov/pubs/sp/800/122/final) (NIST CSRC)
- [Opinion 05/2014 on Anonymisation Techniques](https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2014/wp216_en.pdf) (Article 29 Working Party): singling out, linkability and inference
- Related guides: [Anonymisation vs pseudonymisation](/learn/data-protection/anonymization-vs-pseudonymization), [AI data retention and erasure](/learn/operations/ai-data-retention-and-erasure), [Keeping personal data out of prompts](/learn/security/sensitive-data-in-prompts), [Agent memory](/learn/agents/agent-memory)
