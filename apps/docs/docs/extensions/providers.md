---
title: "Provider SDK: LLM adapters and adding your own"
description: "The L2M provider SDK: the built-in LLM adapters (Echo, Ollama, OpenAI, OpenAI-compatible, Azure OpenAI, Gemini, Anthropic), services reachable through the OpenAI-compatible adapter, and adding a provider."
---

# Provider SDK

LLM providers are adapters in `packages/provider-sdk`. `createDefaultProviderRegistry()` in `packages/provider-sdk/src/index.ts` registers the built-in ones, and every chat model node, agent and [/v1 gateway](../product/ai-gateway) route picks one by its id.

## Adapter contract

Provider adapters expose:

- provider definition metadata (id, label, config fields)
- non-stream generation
- optional streaming generation
- tool-call aware response handling

## Built-in providers

| Provider id | Name in the studio | Default base URL | Key | Streaming |
|---|---|---|---|---|
| `echo` | Echo (built-in demo) | none, runs inside L2M | none | no |
| `ollama` | Ollama | `http://localhost:11434/v1`, or `OLLAMA_BASE_URL` | none | yes |
| `openai_compatible` | OpenAI-Compatible | none: set the **Base URL** | a stored secret, optional | yes |
| `openai` | OpenAI Cloud | `https://api.openai.com/v1` | a stored secret or `OPENAI_API_KEY` | yes |
| `azure_openai` | Azure OpenAI | none: your endpoint, or `AZURE_OPENAI_ENDPOINT` | a stored secret or `AZURE_OPENAI_API_KEY` | yes |
| `gemini` | Gemini | `https://generativelanguage.googleapis.com/v1beta` | a stored secret or `GEMINI_API_KEY` | no |
| `anthropic` | Anthropic Claude | `https://api.anthropic.com/v1` | a stored secret or `ANTHROPIC_API_KEY` | no |

All of them support tool calls. Echo is a test model: it repeats the prompt back and makes at most one labelled demo tool call, only to a tool L2M classifies read-only (see [Build your first MCP agent](../getting-started/build-your-first-mcp-agent)).

An environment key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AZURE_OPENAI_API_KEY`) is only sent to that provider's own endpoint. A node that sets a different base URL needs a stored secret. Keys are always stored as [secrets](../security/secrets) and passed by reference.

## Services reachable through the OpenAI-compatible adapter

Many hosted services and local servers speak the OpenAI Chat Completions API. Pick **OpenAI-Compatible** as the provider, set **Base URL** to the service's base URL below, set **Model** to one of its model names, and store its key as a secret. L2M sends requests to `<Base URL>/chat/completions` with the key as a bearer token.

| Service | Base URL | Source |
|---|---|---|
| Groq | `https://api.groq.com/openai/v1` | [Groq: OpenAI compatibility](https://console.groq.com/docs/openai) |
| Mistral | `https://api.mistral.ai/v1` | [Mistral: migration guides](https://docs.mistral.ai/resources/migration-guides) |
| DeepSeek | `https://api.deepseek.com` | [DeepSeek API docs](https://api-docs.deepseek.com/) |
| Together AI | `https://api.together.ai/v1` | [Together: OpenAI compatibility](https://docs.together.ai/docs/openai-api-compatibility) |
| OpenRouter | `https://openrouter.ai/api/v1` | [OpenRouter quickstart](https://openrouter.ai/docs/quickstart) |
| vLLM (self-hosted) | `http://localhost:8000/v1` by default | [vLLM quickstart](https://docs.vllm.ai/en/latest/getting_started/quickstart.html) |
| LM Studio (local) | `http://localhost:1234/v1` by default | [LM Studio: OpenAI compatibility](https://lmstudio.ai/docs/app/api/endpoints/openai) |

Local servers need no key. With Docker, use `host.docker.internal` instead of `localhost` for a server on your machine, for example `http://host.docker.internal:1234/v1`. Whether tool calls and streaming work depends on the service and the model.

## Serving models to other apps: the /v1 gateway

The direction can also go the other way. L2M itself serves an OpenAI-compatible API at `/v1`: apps outside L2M point an OpenAI SDK at `https://<your-l2m>/v1` and use an L2M client token as the key. Each public model name is a route to one of the providers above, with budgets, rate limits and content rules applied. See [/v1 AI gateway](../product/ai-gateway).

## Add a new provider

1. Implement the adapter in `packages/provider-sdk/src/providers`.
2. Register it in `createDefaultProviderRegistry()` in `packages/provider-sdk/src/index.ts`.
3. Add the provider id to the shared types if needed.
4. Add its fields to the node config modal.
5. Add tests beside the adapter.

A service that already speaks the OpenAI API needs no new adapter: use **OpenAI-Compatible**.
