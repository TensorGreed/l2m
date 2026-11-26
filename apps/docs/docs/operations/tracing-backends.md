---
title: "Send L2M traces to Langfuse, Phoenix or LangSmith"
description: "Receive L2M OpenTelemetry traces in Langfuse, Arize Phoenix or LangSmith over OTLP/HTTP: the endpoint, the auth header and where to set them."
---

# Send traces to Langfuse, Phoenix or LangSmith

L2M exports [OpenTelemetry](./opentelemetry.md) traces over OTLP/HTTP. Langfuse, Arize Phoenix and LangSmith each accept OTLP/HTTP directly, so L2M can send its traces to them with no collector in between. This page gives the settings for each one. Pick the one you use; they work the same way on the L2M side.

Tracing is off until you set an endpoint. Nothing on this page is needed to run L2M.

## How the settings work

Each recipe sets two variables on the L2M API:

- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`: the full traces URL, including the `/v1/traces` path. L2M uses it as it is. It sends traces only, so OTLP metrics (if you turn them on) do not go to a backend that does not take them.
- `OTEL_EXPORTER_OTLP_HEADERS`: comma-separated `key=value` pairs sent with every export, for the backend's key. Values are percent-decoded, so write a space as `%20`. L2M never shows these values: **Settings → Observability → Metrics & Traces** lists header names only.

L2M sends `http/protobuf` by default. All three backends accept it.

Where to set them:

- **Docker** (the [quickstart](../getting-started/install.md)): add the variables under `environment:` of the `api` service in your `docker-compose.yml`, then run `docker compose up -d`. A backend on your own machine is `host.docker.internal` from inside the container, not `localhost`.
- **From source**: put them in `.env`, or in front of `pnpm dev`.

Optionally, name the service with `OTEL_SERVICE_NAME=l2m` so the traces are easy to find.

By default, spans carry ids, timings, model names and token counts, but no prompts or answers. To see the content of model and tool calls in the backend, also set `OTEL_INSTRUMENTATION_GENAI_CAPTURE_CONTENT=SPAN_ONLY`. L2M removes secrets and masks detected data before export; see [content capture](./opentelemetry.md#content-capture).

## Langfuse

Langfuse takes OTLP/HTTP (protobuf or JSON) at `/api/public/otel`. It authenticates with HTTP Basic auth: your project's public key and secret key, joined by a colon and base64-encoded.

1. In Langfuse, open your project's settings and create an API key pair.
2. Encode the pair:

   ```bash
   echo -n "pk-lf-...:sk-lf-..." | base64 -w 0
   ```

   On macOS, leave out `-w 0`.

3. Set, for Langfuse Cloud in the EU region:

   ```bash
   OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://cloud.langfuse.com/api/public/otel/v1/traces
   OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic%20<base64 string>,x-langfuse-ingestion-version=4
   ```

   For the US region, use `https://us.cloud.langfuse.com/api/public/otel/v1/traces`. For a self-hosted Langfuse (v3.22.0 or later), use your Langfuse address, for example `http://localhost:3000/api/public/otel/v1/traces`. Langfuse asks for the `x-langfuse-ingestion-version=4` header so traces show up in real time.

Source: [Langfuse: OpenTelemetry](https://langfuse.com/integrations/native/opentelemetry).

## Arize Phoenix

Phoenix takes OTLP/HTTP at `/v1/traces` on its own port, 6006 by default (the same port as its UI, not 4318). A local Phoenix needs no key.

1. Start Phoenix, for example with `phoenix serve` or its container.
2. Set, for a Phoenix on the same machine:

   ```bash
   OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:6006/v1/traces
   ```

   With L2M in Docker, use `http://host.docker.internal:6006/v1/traces`.

3. For Phoenix Cloud, or a Phoenix with authentication turned on, add your Phoenix API key:

   ```bash
   OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://app.phoenix.arize.com/s/<your-space-name>/v1/traces
   OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer%20<your Phoenix API key>
   ```

Phoenix also listens for OTLP over gRPC on port 4317. L2M does not send gRPC, so use the HTTP port.

Sources: [Phoenix: what is my Phoenix endpoint?](https://arize.com/docs/phoenix/resources/frequently-asked-questions/what-is-my-phoenix-endpoint), [Phoenix: configuration](https://arize.com/docs/phoenix/self-hosting/configuration), [Phoenix: OTLP settings with a bearer header](https://arize.com/docs/phoenix/integrations/platforms/openwebui/openwebui-tracing).

## LangSmith

LangSmith takes OTLP/HTTP at your LangSmith API URL plus `/otel`. It authenticates with an `x-api-key` header.

1. In LangSmith, create an API key.
2. Set, for LangSmith in the US region:

   ```bash
   OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://api.smith.langchain.com/otel/v1/traces
   OTEL_EXPORTER_OTLP_HEADERS=x-api-key=<your LangSmith API key>
   ```

   For the EU region, use `https://eu.api.smith.langchain.com/otel/v1/traces`. For a self-hosted LangSmith, use `https://<your host>/api/v1/otel/v1/traces`.

3. Optionally, send traces to a registered agent and environment by adding both `Langsmith-Agent-Id=<agent id>` and `Langsmith-Agent-Environment=<local, development, staging or production>` to the headers. Send both or neither: LangSmith refuses one without the other.

Source: [LangSmith: trace with OpenTelemetry](https://docs.langchain.com/langsmith/trace-with-opentelemetry).

## Check that traces arrive

1. Restart the L2M API with the new settings. An endpoint that is not an absolute `http://` or `https://` URL stops it at start-up with a message naming the variable.
2. Run any workflow, for example the zero-key **MCP Agent Quickstart** template.
3. Spans are exported in batches every 5 seconds. Look for a trace named `invoke_workflow MCP Agent Quickstart` in the backend, with the agent loop, the model call and the MCP calls under it.
4. In L2M, **Settings → Observability → Metrics & Traces** shows the settings in effect and the most recent spans.

A failed export never slows a run down: it is dropped and counted in `l2m_otel_spans_dropped_total`. If nothing arrives, check the endpoint path, that the header value has `%20` for its space, and the [OpenTelemetry troubleshooting](./opentelemetry.md#troubleshooting) section.

## Related

- [OpenTelemetry](./opentelemetry.md): every setting, the spans L2M emits and content capture
- [Observability](./observability.md): logs and Prometheus metrics
- [OpenTelemetry Collector for agents](../learn/operations/opentelemetry-collector-for-agents.md): when to put a collector in between
