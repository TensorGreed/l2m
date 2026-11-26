---
title: "What is a vector database? Search by meaning"
sidebarTitle: "What is a vector database?"
description: "A vector database stores embeddings and finds the nearest ones to a query. Similarity search, HNSW indexes, metadata filters and RAG, with runnable code."
level: beginner
about: vector-store
related: [vector-store, embedding, cosine-similarity, rag, hybrid-search]
---

# What is a vector database?

A vector database stores <Term id="embedding">embeddings</Term>, lists of numbers that stand for the meaning of a text or an image, and answers one main question: which stored vectors are closest to this one? You embed a query with the same model, ask for the nearest few, and get back the texts with the most similar meaning, even when they share no words. Large stores use an approximate index such as HNSW so they do not compare the query with every vector, and most let you filter by metadata in the same query. This is the search step behind most <Term id="rag">RAG</Term> systems.

The short definition lives in the glossary under <Term id="vector-store">vector store</Term>. This guide shows how the parts work, with a store small enough to read in one go.

## Embeddings: text as points

An embedding model turns a piece of text into a fixed-length list of numbers, a vector. Real models produce hundreds or thousands of numbers per text. The model is trained so that texts with similar meaning get vectors that point in similar directions: "I can't log in" and "use the recovery link on the sign-in page" end up close, and "parcels ship within 48 hours" ends up far from both.

Two rules follow:

- **One model per index.** Vectors from different models are not comparable. The query must be embedded with the model the stored chunks were embedded with.
- **One length per index.** Every vector in an index has the same number of dimensions. Qdrant's docs, for example, say the vector of each point in a collection "must have the same dimensionality and be compared by a single metric".

## Similarity search

To search, you embed the query and score it against stored vectors with a distance or similarity measure. The common ones are cosine similarity, dot product and Euclidean distance; [cosine similarity vs dot product](/learn/tools/cosine-similarity-vs-dot-product) explains how they differ. The store returns the top *k* results: the *k* best scores.

<Term id="cosine-similarity">Cosine similarity</Term> is the usual default for text. It measures the angle between two vectors and ignores their length, from -1 (opposite) to 1 (same direction).

## A vector store in under 50 lines

This store keeps each chunk's text, vector and metadata in an array. Search scores every stored vector with cosine similarity, keeps the ones that pass a metadata filter, and returns the best two.

The vectors here are **toy vectors written by hand**, not the output of an embedding model. Each has four numbers, and each position stands for a rough theme: account access, billing, shipping, returns. A real model's dimensions have no such readable meaning.

```js
// vector-store.mjs: run with `node vector-store.mjs` (Node 24, no dependencies)
// A tiny in-memory vector store. The 4-number "embeddings" are toy vectors
// written by hand, not the output of a model. Each position stands for a rough
// theme: [account access, billing, shipping, returns].
const store = [];

function insert(id, text, vector, metadata) {
  store.push({ id, text, vector, metadata });
}

function cosine(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Exact search: score every vector, keep the ones that pass the filter, sort.
function search(queryVector, { topK = 2, filter = () => true } = {}) {
  return store
    .filter((item) => filter(item.metadata))
    .map((item) => ({ id: item.id, text: item.text, score: cosine(queryVector, item.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

insert("c1", "Use the recovery link on the sign-in page.", [0.9, 0.1, 0.0, 0.0], { lang: "en", product: "web" });
insert("c2", "Card payments can take three days to clear.", [0.1, 0.9, 0.1, 0.0], { lang: "en", product: "web" });
insert("c3", "Parcels ship from our warehouse within 48 hours.", [0.0, 0.1, 0.9, 0.2], { lang: "en", product: "shop" });
insert("c4", "Return an item within 30 days for a refund.", [0.0, 0.3, 0.2, 0.9], { lang: "en", product: "shop" });
insert("c5", "Utilisez le lien de récupération pour vous connecter.", [0.85, 0.05, 0.0, 0.05], { lang: "fr", product: "web" });

// Pretend this is the embedding of "I can't log in".
const query = [0.8, 0.2, 0.0, 0.1];

const show = (label, results) => {
  console.log(label);
  for (const r of results) console.log(`  ${r.id}  ${r.score.toFixed(3)}  ${r.text}`);
};

show("Top 2, no filter:", search(query));
show("Top 2, lang = en:", search(query, { filter: (m) => m.lang === "en" }));
show("Top 2, product = shop:", search(query, { filter: (m) => m.product === "shop" }));
```

Output:

```
Top 2, no filter:
  c1  0.984  Use the recovery link on the sign-in page.
  c5  0.981  Utilisez le lien de récupération pour vous connecter.
Top 2, lang = en:
  c1  0.984  Use the recovery link on the sign-in page.
  c2  0.344  Card payments can take three days to clear.
Top 2, product = shop:
  c4  0.186  Return an item within 30 days for a refund.
  c3  0.052  Parcels ship from our warehouse within 48 hours.
```

What the output shows:

- **Meaning, not words.** The query shares no words with `c1`, yet `c1` comes first, because its vector points the same way. With a real model, that is what the model's training buys you; here we wrote the vectors to make it so.
- **A filter changes the answer.** Without a filter, the French chunk is second. With `lang = en` it drops out, and the next English chunk takes its place.
- **Top *k* returns *k* whenever it can.** With `product = shop`, the best scores are 0.186 and 0.052. Both are poor matches, but the store returns them anyway. A search never says "nothing relevant"; if you need that, set a minimum score.

## Approximate nearest neighbour indexes

The store above compares the query with every vector. That is exact search, and it is fine for thousands of vectors. With millions, scoring every one on every query is too slow, so vector databases build an index that finds *nearly* the nearest vectors while looking at only a small part of them. This is approximate nearest neighbour (ANN) search.

The trade is accuracy for speed. pgvector's README puts it plainly: by default it "performs exact nearest neighbor search, which provides perfect recall", and adding an approximate index "trades some recall for speed". Recall here means the share of the true nearest neighbours that the search actually returns.

**HNSW** (Hierarchical Navigable Small World) is a widely used ANN index, described by Malkov and Yashunin in 2016. At a concept level:

- Each vector is a node in a graph, linked to some of its near neighbours.
- The graph has layers. The top layers hold few nodes with long links, the bottom layer holds every node with short links. Each node's top layer is picked at random.
- A search starts at the top, moves greedily towards the query, then drops a layer and repeats, ending in the bottom layer near the true nearest neighbours.

It works like finding a street: country, then city, then neighbourhood. HNSW indexes have settings that trade memory and build time for accuracy; in Qdrant's docs these are `m`, the "number of edges per node in the index graph", and `ef_construct`, the "number of neighbours to consider during the index building". pgvector supports HNSW and a second index type, IVFFlat.

## Metadata filtering

Each stored vector usually carries metadata: a source document, a language, a date, a tenant or the user who may see it. A filter restricts the search to vectors whose metadata matches. Qdrant calls metadata the payload and combines filter conditions with `must` (all must match), `should` (at least one) and `must_not` (none may match).

Where the filter runs matters:

- **Filter first, then search**, as the toy store does: the results are always the best *k* among the allowed vectors.
- **Search first, then filter**: take the top 10, then drop the ones that do not match. If most of the top 10 fail the filter, you get fewer than 10 results, or none, even though good allowed matches exist further down.

For access control, filtering is not optional. If one store holds documents for many users, a search without a "who may see this" filter can return another user's text.

## How a vector database fits RAG

Retrieval-augmented generation has two phases, and the vector database sits in both.

1. **Ingest.** Split each document into chunks, embed each chunk, and store the vector with its text and metadata.
2. **Query.** Embed the user's question with the same model, search the store for the top few chunks (with filters), and put those chunks in the prompt so the model answers from them.

The store decides what the model gets to read, so its failures become the model's failures. Meaning-based search is weak on exact strings such as error codes and part numbers; <Term id="hybrid-search">hybrid search</Term> adds a keyword search for those. A store also returns what is similar, not what is true: a stale chunk ranks as well as a fresh one. [RAG vs long context](/learn/agents/rag-vs-long-context) and [RAG vs fine-tuning](/learn/agents/rag-vs-fine-tuning) cover when retrieval is the right tool at all.

## Vector databases you will meet

Some are separate services; some are extensions to a database you may already run. Two examples, described from their own docs:

- **Qdrant** stores points (a vector plus a payload) in named collections. Each collection fixes its vector size and one distance metric: `Dot`, `Cosine`, `Euclid` or `Manhattan`.
- **pgvector** is a PostgreSQL extension that adds a `vector` column type. You search with SQL and a distance operator, such as `<->` for Euclidean (L2) distance, `<#>` for negative inner product and `<=>` for cosine distance.

## Vector stores in L2M

L2M's **RAG Retrieve** node does the query step. Its `vectorStoreId` setting picks the store: a built-in [knowledge base](/nodes/knowledge-bases), an in-memory store, or an external store such as pgvector, Qdrant, Pinecone, Azure AI Search, Chroma, Weaviate or Redis ([RAG node reference](/nodes/reference/rag)).

The built-in knowledge base keeps chunks in the L2M database and does exact search: it scores every chunk of the knowledge base with cosine similarity and returns each result's score as `similarityScore`, rounded to three decimals. Its search mode can also be keyword-only or hybrid. For external stores, the node passes the query to the store, so the index and the metric are the store's: the pgvector adapter orders by `<=>`, cosine distance, and a Qdrant search can carry a `filter`. The [RAG knowledge base recipe](/recipes/rag-knowledge-base) builds a working pipeline with no API key.

## Further reading

- [Efficient and robust approximate nearest neighbor search using Hierarchical Navigable Small World graphs](https://arxiv.org/abs/1603.09320) (arXiv): Malkov and Yashunin, the HNSW paper
- [Collections](https://qdrant.tech/documentation/concepts/collections/), [Filtering](https://qdrant.tech/documentation/concepts/filtering/) and [Indexing](https://qdrant.tech/documentation/concepts/indexing/) (Qdrant docs)
- [pgvector README](https://github.com/pgvector/pgvector) (GitHub): the vector type, distance operators, HNSW and IVFFlat indexes
- Related guides: [Cosine similarity vs dot product](/learn/tools/cosine-similarity-vs-dot-product), [RAG vs long context](/learn/agents/rag-vs-long-context), [RAG vs fine-tuning](/learn/agents/rag-vs-fine-tuning)
- In L2M: [Knowledge bases](/nodes/knowledge-bases), [Vector store nodes](/nodes/vector-stores), [RAG knowledge base recipe](/recipes/rag-knowledge-base)
