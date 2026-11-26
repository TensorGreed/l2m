---
title: "Anonymization vs pseudonymization under the GDPR"
sidebarTitle: "Anonymisation vs pseudonymisation"
description: "Pseudonymised data is still personal data; anonymous data is outside the GDPR. The legal tests, why a hashed email is not anonymous, and runnable examples."
level: intermediate
about: pseudonymisation
related: [pseudonymisation, anonymisation, personal-data, pii, data-retention]
---

# Anonymisation vs pseudonymisation

<Term id="pseudonymisation">Pseudonymisation</Term> replaces identifiers so that data can no longer be tied to a person without extra information that is kept separately, such as a key or a lookup table. Under the GDPR, pseudonymised data is still personal data: it lowers the risk, but the law still applies. <Term id="anonymisation">Anonymisation</Term> goes further. The data no longer relates to anyone who can be identified by any means reasonably likely to be used, and then the GDPR does not apply at all. A common mistake is to treat pseudonymised data as anonymous, while a key, a hash or a combination of fields still links it back.

This page explains concepts. It is not legal advice.

## The legal definitions

**Pseudonymisation, GDPR Article 4(5):**

> "the processing of personal data in such a manner that the personal data can no longer be attributed to a specific data subject without the use of additional information, provided that such additional information is kept separately and is subject to technical and organisational measures to ensure that the personal data are not attributed to an identified or identifiable natural person"

The definition has two halves. The data must not point to a person on its own, and the information that would re-link it (the key, the mapping table) must be kept apart and protected.

**Anonymisation** has no article of its own. Recital 26 sets the boundary. To decide whether a person is identifiable, "account should be taken of all the means reasonably likely to be used, such as singling out, either by the controller or by another person", considering the cost, the time needed and the technology available. The principles of data protection "should therefore not apply to anonymous information", meaning data that does not relate to an identifiable person, or personal data "rendered anonymous in such a manner that the data subject is not or no longer identifiable".

The same recital closes the gap between the two: personal data that has undergone pseudonymisation and "could be attributed to a natural person by the use of additional information should be considered to be information on an identifiable natural person".

Recitals 28 and 29 explain why the GDPR mentions pseudonymisation at all. It "can reduce the risks to the data subjects" and help controllers meet their obligations (Recital 28), and it can be applied within one controller when the re-linking information is kept separately (Recital 29). The GDPR also names it as an example measure for data protection by design (Article 25) and for the security of processing (Article 32).

## Side by side

| | Pseudonymisation | Anonymisation |
|---|---|---|
| Legal basis | GDPR Article 4(5) | GDPR Recital 26 |
| Is the result personal data? | Yes | No, if done properly |
| Does the GDPR apply? | Yes, in full | No |
| Can it be reversed? | Yes, by whoever holds the additional information | No one should be able to, by reasonable means |
| Typical techniques | Keyed hashes (HMAC), encryption, tokens with a lookup table | Generalisation, aggregation, noise, removing rare records |
| Keeps records linkable? | Yes: the same person gets the same pseudonym | Usually not, by design |
| Main risk | The key leaks, or the pseudonym can be guessed | Re-identification by combining fields or datasets |
| Good for | Analysis, testing and sharing inside a controlled group | Publishing statistics, open data, long-term research sets |

## What the regulators say

**Article 29 Working Party, Opinion 05/2014 on Anonymisation Techniques (adopted 10 April 2014).** The EU data protection authorities' working group before the EDPB tested techniques against three risks: whether you can still *single out* an individual, whether you can *link* records about the same person, and whether you can *infer* information about them. It describes two families of anonymisation techniques, randomisation (noise, permutation, differential privacy) and generalisation (aggregation, k-anonymity, l-diversity, t-closeness), and says plainly that "pseudonymisation is not a method of anonymisation. It merely reduces the linkability of a dataset with the original identity of a data subject." On hashing, it warns that if the range of inputs is known they can be "replayed through the hash function", that a salted hash may still be reversible "with reasonable means", and that a keyed hash with a secret key is much harder to replay for anyone without the key.

**EDPB Guidelines 01/2025 on Pseudonymisation (adopted 16 January 2025, version for public consultation).** The European Data Protection Board repeats that pseudonymised data "is to be considered information on an identifiable natural person", and adds that this "also holds true if pseudonymised data and additional information are not in the hands of the same person". It introduces the *pseudonymisation domain*: the set of people or systems from whom the pseudonymisation is meant to hide identities. For the transformation, it recommends cryptographic one-way functions such as message authentication codes, with secrets of "sufficient entropy", and gives the warning example that if the transformation "is merely a SHA256 hash of a name, you could apply this to all names you have elsewhere and then see which hashes match". These guidelines came out before the EDPS v SRB judgment below, and the EDPB says it is preparing updated guidance after the consultation (Joint Opinion 2/2026, paragraph 19).

## Plain hash vs keyed pseudonym, in code

The example below shows the warning in practice. A plain hash of an email looks random, but anyone with a list of candidate emails can hash them and find the match. An HMAC with a secret key gives a stable pseudonym that the same guessing cannot reverse. The last part shows generalisation, a step towards anonymisation. All data is invented.

```python
# Plain hash vs keyed HMAC pseudonyms, and generalisation. Toy data only.
import hashlib, hmac, secrets

def plain_hash(email):
    return hashlib.sha256(email.lower().encode()).hexdigest()[:16]

# 1. A "hashed email" shared with a partner.
shared = plain_hash("ann.lee@example.com")
print("shared hash:", shared)

# 2. Anyone with a list of candidate emails can hash them and compare.
candidates = ["bob@example.com", "ann.lee@example.com", "chen@example.org"]
lookup = {plain_hash(e): e for e in candidates}
print("reversed by guessing:", lookup.get(shared))

# 3. A keyed pseudonym: HMAC-SHA256 with a secret kept apart from the data.
key = secrets.token_bytes(32)          # in practice, a managed secret
def pseudonym(email):
    return hmac.new(key, email.lower().encode(), hashlib.sha256).hexdigest()[:16]

p = pseudonym("ann.lee@example.com")
guesses = {plain_hash(e): e for e in candidates}      # attacker without the key
print("keyed pseudonym is stable:", p == pseudonym("Ann.Lee@example.com"))
print("guessing without the key:", guesses.get(p))

# 4. Generalisation: coarsen the quasi-identifiers instead of renaming them.
record = {"age": 37, "postcode": "LS6 3AB", "visit": "2026-03-14"}
general = {"age": f"{record['age'] // 10 * 10}-{record['age'] // 10 * 10 + 9}",
           "postcode": record["postcode"].split()[0],
           "visit": record["visit"][:7]}
print("generalised:", general)
```

Run it with `python3 pseudonyms.py`:

```text
shared hash: b7e0d8372a47f54b
reversed by guessing: ann.lee@example.com
keyed pseudonym is stable: True
guessing without the key: None
generalised: {'age': '30-39', 'postcode': 'LS6', 'visit': '2026-03'}
```

What the output shows:

- **The plain hash is reversed in one dictionary lookup.** Email addresses, phone numbers and ID numbers come from small, guessable sets, so a hash of one is a pseudonym at best, never anonymous.
- **The keyed pseudonym is stable and not guessable without the key.** The same email always maps to the same value, so records can still be joined for analysis. But it is still personal data: whoever holds the key can recompute the pseudonym for any email they know and find that person's records. That is why the key must be stored apart from the data, with its own access controls.
- **Generalisation removes detail instead of renaming it.** An age band, a postcode area and a month are harder to link than exact values. Whether the result is anonymous depends on the whole dataset: if one row is still the only "30-39, LS6, March" record, it still singles someone out ([how combining fields singles someone out](/learn/data-protection/pii-vs-personal-data#how-combining-fields-singles-someone-out)).

## Whose point of view counts: the EDPS v SRB judgment

In *EDPS v SRB* (case C-413/23 P, judgment of 4 September 2025), the Court of Justice of the EU looked at pseudonymised comments that the Single Resolution Board sent to a consultancy, Deloitte. The case was decided under Regulation (EU) 2018/1725, the data protection rules for EU institutions, whose definitions of personal data and pseudonymisation mirror the GDPR's.

The Court held that pseudonymised data "must not be regarded as constituting, in all cases and for every person, personal data" (paragraph 86). For the Board, which kept the information to re-link the comments, they stayed personal data (paragraph 76). For Deloitte they might not be, but only if Deloitte could not lift the pseudonymisation measures and could not identify the people by other means, such as cross-checking with other data (paragraph 77). And if a later recipient may have the means to identify the people, the data is personal for that recipient (paragraph 85). On the duty to inform people, the Court said identifiability is assessed when the data is collected, from the point of view of the controller (paragraph 111). It set aside the General Court's judgment and sent the case back to it.

In short: the same pseudonymised dataset can be personal data for the organisation that holds the key and, in some circumstances, not for a recipient that has no way to re-identify anyone. It stays personal data for the organisation that keeps the information to re-link it.

The European Commission has proposed writing a version of this recipient-based reading into the GDPR's definition of personal data, as part of its Digital Omnibus proposal (COM(2025) 837). It is a proposal, not law. The EDPB and the EDPS, in their Joint Opinion 2/2026 of 10 February 2026, urged the co-legislators not to adopt that change.

## Which to use when

**Pseudonymise when** you still need to join records about the same person, or to re-identify them later: debugging a user's conversation, running evaluations on real traffic, analytics by user, sharing data with a processor. Treat the output as personal data, keep the key elsewhere, and limit who can reach both.

**Anonymise when** nobody downstream needs to know who anyone is: published statistics, usage dashboards, research sets kept long term. Test the result against singling out, linkability and inference, and expect to lose detail.

**For AI systems in particular:**

- **Logs and traces.** Replacing user IDs with keyed pseudonyms keeps traces joinable for debugging. It does not take them out of the GDPR, so they still need a retention period ([AI data retention and erasure](/learn/operations/ai-data-retention-and-erasure)).
- **Evaluation sets built from real conversations.** Swapping names for placeholders is pseudonymisation at most. Free text often holds other identifying details, such as a job, a town or an unusual event.
- **Embeddings.** A vector computed from text about a person, stored next to a user ID, is no more anonymous than the text.
- **Prompts to hosted models.** Pseudonymising values before they reach a model reduces what the provider sees, as long as the key stays with you ([keeping personal data out of prompts](/learn/security/sensitive-data-in-prompts)).

## Further reading

- [Regulation (EU) 2016/679, the General Data Protection Regulation](https://eur-lex.europa.eu/eli/reg/2016/679/oj) (EUR-Lex): Article 4(5), Articles 25 and 32, Recitals 26, 28 and 29
- [Opinion 05/2014 on Anonymisation Techniques](https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2014/wp216_en.pdf) (Article 29 Working Party)
- [Guidelines 01/2025 on Pseudonymisation](https://www.edpb.europa.eu/our-work-tools/documents/public-consultations/2025/guidelines-012025-pseudonymisation_en) (EDPB)
- [Judgment in case C-413/23 P, EDPS v SRB](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62023CJ0413) (EUR-Lex)
- [EDPB-EDPS Joint Opinion 2/2026 on the Digital Omnibus proposal](https://www.edpb.europa.eu/system/files/documents/2026-02/edpb_edps_jointopinion_202602_digitalomnibus_en.pdf) (EDPB)
- Related guides: [PII vs personal data](/learn/data-protection/pii-vs-personal-data), [AI data retention and erasure](/learn/operations/ai-data-retention-and-erasure), [Keeping personal data out of prompts](/learn/security/sensitive-data-in-prompts)
