---
title: "MCP interview questions and answers"
sidebarTitle: "MCP interview questions"
description: "29 MCP interview questions with short answers on roles, tools, transports, sessions, OAuth, security and testing, checked against the 2026-07-28 spec."
level: intermediate
about: model-context-protocol
related: [model-context-protocol, mcp-host, mcp-client, mcp-server, mcp-tool, json-rpc, streamable-http, token-passthrough]
---

# MCP interview questions and answers

Most interview questions about the <Term id="model-context-protocol">Model Context Protocol</Term> (MCP) test five things: the three roles (host, client, server), the three things a server offers (tools, resources, prompts), how messages travel (JSON-RPC 2.0 over stdio or Streamable HTTP), how remote servers are secured (OAuth 2.1, no token passthrough), and how you build and test a server. The 29 questions below cover those, each with a short answer and a link to the guide that goes deeper. Answers follow the current revision of the specification, 2026-07-28, and say where the previous one, 2025-11-25, differs, because many servers and SDKs still speak it.

## Basics

### What is MCP?

MCP is an open protocol for connecting AI applications to tools and data. A program called an MCP server offers tools, resources and prompts; an AI application connects to it as an MCP client, lists what it offers and calls it with JSON-RPC messages. A tool author writes one server, and any MCP-capable application can use it. See [What is MCP?](/learn/mcp/what-is-mcp).

### What problem does MCP solve?

Without a shared protocol, every pairing of an AI application and a tool needs its own integration code, each with its own way of describing arguments, results and errors. MCP replaces that with one contract on each side: servers describe their tools in a standard format, and clients discover and call them the same way everywhere. It makes tools portable; it does not make models smarter. See [What is MCP?](/learn/mcp/what-is-mcp#the-problem-it-solves).

### How is MCP different from function calling?

Function calling (tool calling) is a feature of a model's API: you send tool definitions with the request, and the model can answer with a tool name and JSON arguments instead of text. MCP sits on the other side of your application: it is how the application finds tools on separate servers (`tools/list`) and runs them (`tools/call`). An agent usually uses both: MCP to get tool definitions and run calls, function calling to let the model choose them. See [MCP vs function calling](/learn/mcp/mcp-vs-function-calling).

### How is MCP different from a REST API?

A REST API is one service's own interface, with many URLs and methods, designed for developers who read its documentation. MCP is one fixed interface for every server, with descriptions written for a model to read. They are not rivals: many MCP servers call a REST API underneath. See [MCP vs REST APIs](/learn/mcp/mcp-vs-rest-api).

### How does MCP relate to A2A?

MCP connects an agent to tools and data, one request and one result at a time. The Agent2Agent protocol (A2A) connects an agent to another agent treated as a peer, usually through a task that can run for a long time. The A2A specification calls them "complementary protocols", and a system can use both. See [MCP vs A2A](/learn/mcp/mcp-vs-a2a).

## Architecture

### What are the host, the client and the server?

The <Term id="mcp-host">host</Term> is the application a person uses, such as a chat app, an IDE or an agent runtime: it owns the model, the conversation and consent. An <Term id="mcp-client">MCP client</Term> lives inside the host and "communicates with exactly one server". An <Term id="mcp-server">MCP server</Term> is a program that offers capabilities, as a local process or a remote service. A host with three servers runs three clients ([Architecture](https://modelcontextprotocol.io/specification/2026-07-28/architecture), "Core Components"). See [Hosts, clients and servers](/learn/mcp/hosts-clients-servers).

### Why does each server get its own client?

Isolation. One of the specification's design principles is that "Servers should not be able to read the whole conversation, nor "see into" other servers": the full history stays with the host, and the host controls anything that passes between servers. A separate client per server keeps each connection, and what it is told, apart. See [Hosts, clients and servers](/learn/mcp/hosts-clients-servers#one-host-many-clients).

### What message format does MCP use?

<Term id="json-rpc">JSON-RPC 2.0</Term>, encoded as UTF-8. There are requests (with an `id`, which in MCP must not be `null`), responses carrying either a `result` or an `error`, and notifications, which have no `id` and get no answer. In 2026-07-28 every result also carries a `resultType`: `"complete"` for a normal answer, `"input_required"` when the server needs more input first ([Overview](https://modelcontextprotocol.io/specification/2026-07-28/basic/index), "Messages"; [Transports](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports), "Messages").

A `tools/call` request and its result in the 2026-07-28 revision look like this. The `_meta` block is new: every request carries its protocol version and client capabilities.

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "get_weather",
    "arguments": { "location": "New York" },
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { "name": "ExampleClient", "version": "1.0.0" },
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}
```

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "resultType": "complete",
    "content": [{ "type": "text", "text": "Current weather in New York:\nTemperature: 72°F\nConditions: Partly cloudy" }],
    "isError": false
  }
}
```

Both follow the specification's examples; the request's `_meta` block is from the Overview's example, without its trace-context field ([Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), "Calling Tools", and [Overview](https://modelcontextprotocol.io/specification/2026-07-28/basic/index), "`_meta`").

### How are MCP versions named, and how do two sides agree on one?

A version is a date, `YYYY-MM-DD`, the last date a backwards-incompatible change was made; 2026-07-28 is the current revision. In 2025-11-25 and earlier, the client and server agree a version once, in an `initialize` handshake. In 2026-07-28 there is no handshake: each request names its version in `_meta`, a server that does not support it answers with an `UnsupportedProtocolVersionError` listing the versions it does, and a client can ask up front with `server/discover` ([Versioning](https://modelcontextprotocol.io/specification/versioning)). See [Unsupported protocol version](/learn/troubleshooting/mcp-unsupported-protocol-version).

### What is the biggest change in the 2026-07-28 revision?

MCP became stateless. The `initialize` handshake and protocol-level sessions are gone, every request carries its own version and capabilities, and servers must implement `server/discover`. A server that needs something from the client mid-request, such as an answer from the person, now returns an `input_required` result and the client retries the request with the answer, instead of the server sending its own request. Roots, sampling, logging and dynamic client registration are deprecated ([Key changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog)). See [MCP transports](/learn/mcp/transports#what-2026-07-28-changes).

## Tools, resources and prompts

### What is the difference between tools, resources and prompts?

The specification separates them by who decides when each is used. Tools are "model-controlled": the model chooses to call them. Resources are "application-driven": the host decides which data to read and attach as context. Prompts are "user-controlled": a person picks a template, often as a slash command. The specification adds that implementations are free to expose each one however they like; the control model is a design intent. See [Tools, resources and prompts](/learn/mcp/tools-resources-prompts).

### What is in a tool definition?

A `name`, and optionally a `title` for display and a `description`; an `inputSchema` (JSON Schema for the arguments, required); and optionally an `outputSchema`, `annotations` and `icons`. Names SHOULD be 1 to 128 characters of letters, digits, `_`, `-` and `.`, and unique within a server. The model sees the name, description and schema, never the code behind them ([Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), "Tool"). See [Designing tools for agents](/learn/agents/designing-tools-for-agents).

### What are `outputSchema` and `structuredContent`?

<Term id="structured-tool-output">Structured tool output</Term> is JSON in a result's `structuredContent` field, for code that reads a tool's answer. If a tool declares an `outputSchema`, servers MUST return structured results that conform to it and clients SHOULD validate them. A tool that returns structured content SHOULD also return the same JSON as text, for clients that only read text. The specification notes it is unrelated to a model's "structured outputs" feature. See [Tools, resources and prompts](/learn/mcp/tools-resources-prompts#structured-output-and-output-schemas).

### What are the two kinds of tool errors?

A tool execution error is a normal result with `isError: true`, such as an upstream API failure or an argument in the wrong format; clients SHOULD pass it to the model so it can correct itself. A protocol error is a JSON-RPC error, such as an unknown tool (the specification's example uses `-32602`) or a malformed request; passing it to the model is optional, because models are "less likely to be able to fix" it ([Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), "Error Handling"). The code sample under the next section shows both on the wire. See [-32602 Invalid params](/learn/troubleshooting/json-rpc-32602-invalid-params).

### Can a client trust tool annotations such as `readOnlyHint`?

No, not by default. Annotations are hints a server attaches to a tool: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`. The specification says clients "MUST consider tool annotations to be untrusted unless they come from trusted servers". Use them to decide what to ask a person about, but check or override them for tools that matter. See [Tool annotations](/learn/mcp/tool-annotations).

### What are elicitation and sampling?

Both go from server to client. With <Term id="elicitation">elicitation</Term>, the server asks the person for input through the client, in form mode (a flat schema of simple fields) or URL mode (a link for steps that must not pass through the client); servers MUST NOT use form mode for passwords, API keys, tokens or payment details. With <Term id="sampling">sampling</Term>, the server asks the client's model for a completion. In 2026-07-28 both arrive inside an `input_required` result, and sampling is deprecated ([Elicitation](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation)). See [Tools, resources and prompts](/learn/mcp/tools-resources-prompts#elicitation-and-sampling).

## Transports and sessions

### Which transports does MCP define?

Two. With <Term id="stdio-transport">stdio</Term>, the client starts the server as a child process and they exchange one JSON-RPC message per line over its standard input and output. With <Term id="streamable-http">Streamable HTTP</Term>, the client sends each message as an HTTP POST to one endpoint, and the server answers with one JSON object or a server-sent events (SSE) stream for that request. Custom transports are allowed if they keep the message format. The older HTTP+SSE transport from 2024-11-05 is deprecated ([Transports](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)). See [MCP transports](/learn/mcp/transports).

### What are the rules a stdio server must follow?

Messages are newline-delimited and MUST NOT contain embedded newlines. The server MUST NOT write anything to stdout that is not a valid MCP message, so a stray `print` breaks the stream; logs go to stderr, and the client SHOULD NOT assume stderr output means an error. To shut down, the client closes the server's stdin and waits, then forces it to stop if needed ([stdio](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)). See [Connection closed (-32000)](/learn/troubleshooting/mcp-error-32000-connection-closed).

### What headers does a Streamable HTTP request need?

An `Accept` header listing both `application/json` and `text/event-stream`, and an `MCP-Protocol-Version` header. In 2026-07-28 the client also sends `Mcp-Method` on every request and `Mcp-Name` on `tools/call`, `resources/read` and `prompts/get`, so gateways can route without reading the body; a header that does not match the body gets `400` with a `HeaderMismatch` error ([Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http), "Request Metadata"). Add `Authorization: Bearer` for a protected server.

### What is an MCP session, and does it still exist?

In 2025-11-25, a Streamable HTTP server could return an `Mcp-Session-Id` header with the `initialize` result; the client sent it on every later request, and a server that forgot it answered `404`, forcing a new session. Sessions kept in one process's memory need sticky routing behind a load balancer. The 2026-07-28 revision removes sessions entirely, so any instance can answer any request. See [Session not found (404)](/learn/troubleshooting/mcp-session-not-found-404) and the glossary entry for <Term id="mcp-session">MCP session</Term>.

### Without sessions, how does a server keep state between calls?

It mints an explicit handle, such as a basket id, returns it from one tool call and accepts it as an ordinary argument on the next; the model carries it forward. The specification's guidance is that servers should check the caller's authorization against the handle on every call, and its security best practices say a server MUST NOT treat possession of a handle as authentication. An expired handle should come back as a tool execution error so the model can start again ([Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), "Stateful Tools"; [Security Best Practices](https://modelcontextprotocol.io/specification/latest/basic/security_best_practices), "State Handle Hijacking").

## Security and auth

### How does authorization work for a remote MCP server?

It is optional, and built on <Term id="oauth-2-1">OAuth 2.1</Term>. The MCP server is a resource server: it answers an unauthenticated request with `401` and a `WWW-Authenticate` header pointing at its protected resource metadata (RFC 9728), which names its authorization server. The client signs the person in with <Term id="pkce">PKCE</Term>, sends a `resource` parameter naming the MCP server (RFC 8707), and then sends the token as a bearer token on every request, never in the query string ([Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)). See [MCP authorization](/learn/mcp/authorization).

### Why don't stdio servers use OAuth?

The specification says implementations using stdio "SHOULD NOT follow this specification, and instead retrieve credentials from the environment". A local server is started by its client, so the host passes it an API key or similar as an environment variable. Nothing listens on the network, so only the client that started it can reach it. See [MCP authorization](/learn/mcp/authorization#when-mcp-needs-authorization).

### What is token passthrough, and why is it forbidden?

<Term id="token-passthrough">Token passthrough</Term> is a server forwarding the token it received from the client to a downstream API instead of getting its own. It breaks audience checks, lets callers bypass the downstream API's controls, and leaves audit logs pointing at the wrong caller. The rule: MCP servers "MUST NOT accept any tokens that were not explicitly issued for the MCP server", and a server that calls other APIs gets separate tokens for them ([Security Best Practices](https://modelcontextprotocol.io/specification/latest/basic/security_best_practices), "Token Passthrough"). See [MCP security risks](/learn/security/mcp-security-risks#token-passthrough).

### What are tool poisoning and rug pulls?

<Term id="tool-poisoning">Tool poisoning</Term> hides instructions in a tool's description, schema or results, which go straight into the model's context. A <Term id="rug-pull">rug pull</Term> is a server changing its tool definitions after you reviewed them. Controls: review the whole definition, record a hash of what you approved and compare it on every connection, pin server versions, and treat tool output as untrusted data. See [MCP security risks](/learn/security/mcp-security-risks) and [Prompt injection](/learn/security/prompt-injection).

### What should a local HTTP server and a one-click install do to stay safe?

A Streamable HTTP server MUST validate the `Origin` header and answer `403` to an invalid one, which blocks DNS rebinding from a web page; locally it SHOULD bind to `127.0.0.1`, not `0.0.0.0`. A client that offers one-click setup of a local server MUST show the exact command, without truncation, and get explicit approval first, and SHOULD run it in a sandbox with minimal privileges ([Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http), "Security & Endpoint"; [Security Best Practices](https://modelcontextprotocol.io/specification/latest/basic/security_best_practices), "Local MCP Server Compromise"). See [MCP security risks](/learn/security/mcp-security-risks#local-server-compromise).

## Building and testing

### How do you build a minimal MCP server?

Create a server object, register a tool with a name, a description and an input schema, and connect it to a transport. The sample below uses the official TypeScript SDK (`@modelcontextprotocol/server` and `@modelcontextprotocol/client` 2.4.0, with `zod` 4.6.7), with the client and server linked in memory so it runs with no network. It wraps the transports to print every JSON-RPC message, then makes one good call, one call with a bad argument and one call to a tool that does not exist.

```js
// mcp-in-memory.mjs: one server, one client, linked in memory. Prints every JSON-RPC message.
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';
import * as z from 'zod/v4';

const server = new McpServer({ name: 'word-tools', version: '1.0.0' });
server.registerTool(
  'count_words',
  {
    description: 'Count the words in a piece of text.',
    inputSchema: z.object({ text: z.string() }),
    annotations: { readOnlyHint: true }
  },
  async ({ text }) => ({
    content: [{ type: 'text', text: String(text.split(/\s+/).filter(Boolean).length) }]
  })
);

// Log what the client sends (→) and what the server sends back (←).
const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
const log = (arrow, t) => {
  const send = t.send.bind(t);
  t.send = (msg, opts) => (console.log(arrow, JSON.stringify(msg)), send(msg, opts));
};
log('→', clientSide);
log('←', serverSide);

await server.connect(serverSide);
const client = new Client({ name: 'demo-client', version: '1.0.0' });
await client.connect(clientSide);

const result = await client.callTool({ name: 'count_words', arguments: { text: 'hello MCP world' } });
console.log('result:', result.content[0].text);

// Two kinds of failure: a bad argument comes back as a result with isError: true,
// an unknown tool as a JSON-RPC error.
await client.callTool({ name: 'count_words', arguments: { text: 5 } });
await client.callTool({ name: 'count_letters', arguments: {} }).catch((e) => console.log('thrown:', e.message));
await client.close();
```

The output with Node.js 24:

```text
→ {"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"demo-client","version":"1.0.0"}},"jsonrpc":"2.0","id":0}
← {"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"word-tools","version":"1.0.0"}},"jsonrpc":"2.0","id":0}
→ {"jsonrpc":"2.0","method":"notifications/initialized"}
→ {"method":"tools/call","params":{"name":"count_words","arguments":{"text":"hello MCP world"}},"jsonrpc":"2.0","id":1}
← {"result":{"content":[{"type":"text","text":"3"}]},"jsonrpc":"2.0","id":1}
result: 3
→ {"method":"tools/call","params":{"name":"count_words","arguments":{"text":5}},"jsonrpc":"2.0","id":2}
← {"result":{"content":[{"type":"text","text":"Input validation error: Invalid arguments for tool count_words: text: Invalid input: expected string, received number"}],"isError":true},"jsonrpc":"2.0","id":2}
→ {"method":"tools/call","params":{"name":"count_letters","arguments":{}},"jsonrpc":"2.0","id":3}
← {"jsonrpc":"2.0","id":3,"error":{"code":-32602,"message":"Tool count_letters not found"}}
thrown: Tool count_letters not found
```

Three things an interviewer may ask about it. By default this SDK version opens with the 2025-11-25 `initialize` handshake, so the trace shows the previous revision's lifecycle; a 2026-07-28 exchange has no `initialize` and carries `_meta` on each request instead. The bad argument never reaches the handler: the SDK checks it against the input schema and answers with `isError: true`, a tool execution error. The unknown tool is a JSON-RPC protocol error, `-32602`, and the client throws it rather than returning a result. [Build a minimal MCP server](/learn/mcp-servers/build-a-minimal-mcp-server) serves the same kind of tool over stdio and Streamable HTTP.

### How do you test an agent that calls MCP tools?

Take the live servers out of the test. Record the calls a good run makes and answer them from that recording (a <Term id="cassette">cassette</Term>), stand in for a server with a mock built from its tool schemas, and compare each server's schemas with the last version you accepted, so a breaking change fails the build. Each catches a different failure, and none proves the live server still works. See [Testing MCP tools](/learn/testing/testing-mcp-tools).

### A server connects but shows no tools. What do you check?

Ask the server for its tools by hand first. If it lists none, the listing failed after connecting, the server registers nothing in this configuration (a missing token or flag), or it never declared the `tools` capability. If it does list them, the cause is on the client: a tool selection or allow-list that no longer matches, a policy that hides them, tool names the model provider rejects, or pagination that stopped early. See [Server shows no tools](/learn/troubleshooting/mcp-server-shows-no-tools).

## Self-check quiz

Five questions to test yourself. Open each answer after you have one of your own.

**1. A tool call fails because the date argument is in the past. Should the server return a JSON-RPC error or a result with `isError: true`?**

::: details Answer
A result with `isError: true` and a message saying what is wrong. It is a tool execution error, which clients should pass to the model so it can retry with a better argument. JSON-RPC errors are for problems with the request itself, such as an unknown tool.
:::

**2. Your stdio server works when you run it alone but the client reports "connection closed" straight after start-up. What is the first thing to look for?**

::: details Answer
Something writing to stdout that is not an MCP message, such as a start-up banner or a debug `print`. On stdio, stdout carries only JSON-RPC messages; logs belong on stderr.
:::

**3. Which side owns consent and approval decisions: the host, the client or the server?**

::: details Answer
The host. The specification gives the host the jobs of enforcing security policies and consent and handling user authorization decisions. A client is one connection to one server, and a server only sees the requests it receives.
:::

**4. Your MCP server calls a third-party API for each tool. Can it forward the bearer token it received from the MCP client?**

::: details Answer
No. That is token passthrough, which the specification forbids. The server must accept only tokens issued for itself, and get its own credential for the third-party API.
:::

**5. A client speaks only 2026-07-28. What does it send instead of an `initialize` request?**

::: details Answer
Nothing in its place: it sends ordinary requests, each with its protocol version and client capabilities in `_meta`. It may call `server/discover` first to learn the server's versions and capabilities, and a server that does not support the version answers with an `UnsupportedProtocolVersionError`.
:::

## Further reading

- [MCP specification 2026-07-28: Key changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog) (modelcontextprotocol.io)
- [MCP specification 2026-07-28: Architecture](https://modelcontextprotocol.io/specification/2026-07-28/architecture) (modelcontextprotocol.io)
- [MCP specification 2026-07-28: Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) (modelcontextprotocol.io)
- [MCP specification 2026-07-28: Transports](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports) (modelcontextprotocol.io)
- [MCP specification 2026-07-28: Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) (modelcontextprotocol.io)
- [MCP Security Best Practices](https://modelcontextprotocol.io/specification/latest/basic/security_best_practices) (modelcontextprotocol.io)
- [MCP specification: Versioning](https://modelcontextprotocol.io/specification/versioning) (modelcontextprotocol.io)
- Related guides: [What is MCP?](/learn/mcp/what-is-mcp), [Hosts, clients and servers](/learn/mcp/hosts-clients-servers), [Tools, resources and prompts](/learn/mcp/tools-resources-prompts), [MCP transports](/learn/mcp/transports), [MCP authorization](/learn/mcp/authorization), [MCP security risks](/learn/security/mcp-security-risks), [Build a minimal MCP server](/learn/mcp-servers/build-a-minimal-mcp-server)
