---
title: "Cosine similarity vs dot product: what differs"
sidebarTitle: "Cosine vs dot product"
description: "Cosine similarity ignores vector length; the dot product does not. Formulas, a worked example, Euclidean distance, and why unit vectors make them agree."
level: beginner
about: cosine-similarity
related: [cosine-similarity, embedding, vector-store, rag]
---

# Cosine similarity vs dot product

The dot product multiplies two vectors position by position and adds the results, so it grows with both the angle between them and their lengths. <Term id="cosine-similarity">Cosine similarity</Term> is the dot product divided by the two lengths, so it measures only the angle, from -1 to 1. When every vector has length 1, the two are the same number, and ranking by Euclidean distance gives the same order too. They differ only when vector lengths differ, and then the dot product favours long vectors.

## The three formulas

For two vectors **a** and **b** with *n* numbers each:

- **Dot product:** a · b = a₁b₁ + a₂b₂ + … + aₙbₙ. Higher means more similar. No fixed range.
- **Length (norm):** ‖a‖ = √(a · a), the square root of the sum of squares.
- **Cosine similarity:** cos(a, b) = (a · b) / (‖a‖ ‖b‖). Higher means more similar. Range -1 to 1.
- **Euclidean distance:** ‖a − b‖ = √((a₁ − b₁)² + … + (aₙ − bₙ)²). The straight-line distance. *Lower* means more similar. Range 0 upwards.

Cosine similarity is a dot product with the lengths divided out. Euclidean distance looks at the gap between the two points, so both direction and length count.

## A worked example

Take a query **q** = (1, 2) and three stored vectors:

- **A** = (2, 4): the same direction as **q**, twice as long.
- **B** = (10, 10): a different direction, and very long.
- **C** = (2, 1): a different direction, about as long as **q**.

For **q** and **A**:

- Dot product: 1×2 + 2×4 = 10.
- Lengths: ‖q‖ = √5 ≈ 2.236, ‖A‖ = √20 ≈ 4.472.
- Cosine: 10 / (√5 × √20) = 10 / 10 = 1. Same direction, so the maximum.
- Euclidean: √((1−2)² + (2−4)²) = √5 ≈ 2.236.

For **q** and **B**: the dot product is 1×10 + 2×10 = 30, three times A's. The cosine is 30 / (√5 × √200) ≈ 0.949. The Euclidean distance is √(81 + 64) ≈ 12.042.

So the three measures disagree about which vector is "closest":

- **Dot product** picks **B** (30), because B is long.
- **Cosine** picks **A** (1.000), because A points exactly the same way.
- **Euclidean** picks **C** (1.414), because C's point is nearest on the plane.

Now scale every vector to length 1 (divide it by its length) and run the same comparison. All three now agree.

## The same thing in code

```js
// metrics.mjs: run with `node metrics.mjs` (Node 24, no dependencies)
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const length = (a) => Math.sqrt(dot(a, a));
const cosine = (a, b) => dot(a, b) / (length(a) * length(b));
const euclidean = (a, b) => Math.sqrt(a.reduce((sum, x, i) => sum + (x - b[i]) ** 2, 0));
const normalise = (a) => a.map((x) => x / length(a));

const fmt = (n) => n.toFixed(3).padStart(7);
const report = (title, query, docs) => {
  console.log(title);
  console.log("  doc     dot  cosine  euclid");
  for (const [name, v] of Object.entries(docs)) {
    console.log(`  ${name}  ${fmt(dot(query, v))} ${fmt(cosine(query, v))} ${fmt(euclidean(query, v))}`);
  }
};

const query = [1, 2];
const docs = {
  A: [2, 4],    // same direction as the query, twice as long
  B: [10, 10],  // a different direction, but very long
  C: [2, 1],    // a different direction, about the query's length
};

report("Raw vectors:", query, docs);

const unitQuery = normalise(query);
const unitDocs = Object.fromEntries(Object.entries(docs).map(([k, v]) => [k, normalise(v)]));
report("Unit-length vectors:", unitQuery, unitDocs);

const rank = (q, ds, score, higherIsBetter) =>
  Object.keys(ds).sort((a, b) => {
    const d = score(q, ds[a]) - score(q, ds[b]);
    return higherIsBetter ? -d : d;
  }).join(" > ");
for (const [title, q, ds] of [["raw", query, docs], ["unit", unitQuery, unitDocs]]) {
  console.log(`Ranking, ${title} vectors:`);
  console.log("  by dot:      ", rank(q, ds, dot, true));
  console.log("  by cosine:   ", rank(q, ds, cosine, true));
  console.log("  by euclidean:", rank(q, ds, euclidean, false));
}
const [u, v] = [unitQuery, unitDocs.B];
console.log("Check: euclid^2 =", (euclidean(u, v) ** 2).toFixed(3), " 2 - 2*cosine =", (2 - 2 * cosine(u, v)).toFixed(3));
```

Output:

```
Raw vectors:
  doc     dot  cosine  euclid
  A   10.000   1.000   2.236
  B   30.000   0.949  12.042
  C    4.000   0.800   1.414
Unit-length vectors:
  doc     dot  cosine  euclid
  A    1.000   1.000   0.000
  B    0.949   0.949   0.320
  C    0.800   0.800   0.632
Ranking, raw vectors:
  by dot:       B > A > C
  by cosine:    A > B > C
  by euclidean: C > A > B
Ranking, unit vectors:
  by dot:       A > B > C
  by cosine:    A > B > C
  by euclidean: A > B > C
Check: euclid^2 = 0.103  2 - 2*cosine = 0.103
```

Three things to read from it:

- **Cosine does not change** when you normalise. It never looked at length.
- **On unit vectors, dot product equals cosine**, digit for digit. Dividing by ‖a‖ ‖b‖ is dividing by 1 × 1.
- **On unit vectors, Euclidean gives the same order.** The last line shows why: for vectors of length 1, the squared distance is exactly 2 − 2 × cosine. A higher cosine always means a smaller distance, so the two rankings cannot differ.

## Side by side

| | Dot product | Cosine similarity | Euclidean distance |
|---|---|---|---|
| Measures | Angle and both lengths | Angle only | Gap between the two points |
| Better match | Higher | Higher | Lower |
| Range | Any number | -1 to 1 | 0 upwards |
| Effect of a longer vector | Raises the score | None | Usually raises the distance |
| Cost | Cheapest: one sum | Dot product plus two lengths | One sum of squared gaps |
| On unit-length vectors | Equals cosine | Equals dot product | Same ranking as the other two |

## What models and databases say

Check the docs of your embedding model and your store. Three examples, from their own documentation:

- **OpenAI embeddings.** The embeddings guide's FAQ recommends cosine similarity and says "OpenAI embeddings are normalized to length 1". It adds that cosine similarity can then be computed "slightly faster using just a dot product", and that cosine similarity and Euclidean distance "will result in the identical rankings".
- **Qdrant.** A collection uses one metric: `Dot`, `Cosine`, `Euclid` or `Manhattan`. Its docs say that "Cosine similarity is implemented as dot-product over normalized vectors", and that vectors are normalised automatically during upload.
- **pgvector.** Operators are `<#>` for negative inner product (the dot product times -1, because Postgres index scans only run in ascending order), `<=>` for cosine distance and `<->` for Euclidean (L2) distance. For vectors normalised to length 1, its README suggests inner product "for best performance".

Note the word *distance*. Cosine distance is 1 minus cosine similarity, so smaller is better, the opposite direction from the similarity. Read which one your store returns before you set a score threshold.

## Which to use when

- **Use what the embedding model's docs say.** The model was trained with a measure in mind. If the docs name one, use it.
- **Cosine is the safe default for text** when you are not sure the vectors have length 1. It cannot be thrown off by length.
- **Dot product is fine, and fastest, on unit vectors.** If the model already returns length-1 vectors, or you normalise them once at ingest, the dot product gives the cosine for less work. Normalise the query too.
- **Use the raw dot product only when length is meant to count.** A system may put a signal such as strength or popularity into a vector's length on purpose. Then a longer vector *should* score higher, and cosine would throw that away. Do not do this by accident: unnormalised vectors with the dot product let a few long vectors win every search.
- **Euclidean distance** suits data where position matters, such as coordinates or feature measurements on the same scale. On unit vectors it ranks the same as cosine, so it is a matter of convenience.
- **Never mix.** Use the same measure at index time and query time, and never compare scores from one measure with thresholds set for another.

## In L2M

The built-in [knowledge base](/nodes/knowledge-bases) ranks chunks by cosine similarity and returns each result's score as `similarityScore`, rounded to three decimals. Because it uses cosine, it does not matter whether the embedder's vectors have length 1. External stores use their own metric: the pgvector adapter orders by `<=>`, cosine distance, and a Qdrant collection uses the metric it was created with. [What is a vector database?](/learn/tools/what-is-a-vector-database) shows where the measure fits in search.

## Further reading

- [Embeddings guide: which distance function should I use?](https://developers.openai.com/api/docs/guides/embeddings#which-distance-function-should-i-use) (OpenAI docs)
- [Collections: distance metrics](https://qdrant.tech/documentation/concepts/collections/) (Qdrant docs)
- [pgvector README: querying and distance operators](https://github.com/pgvector/pgvector) (GitHub)
- Related guides: [What is a vector database?](/learn/tools/what-is-a-vector-database), [RAG vs long context](/learn/agents/rag-vs-long-context)
- In L2M: [Knowledge bases](/nodes/knowledge-bases), [Vector store nodes](/nodes/vector-stores)
