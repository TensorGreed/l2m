---
title: "Webhooks and schedules for agents: signed and safe"
sidebarTitle: "Webhooks and schedules"
description: "Start agents from events and timetables safely: sign webhooks, reject replays, use idempotency keys, and give each schedule a time zone and an owner."
level: intermediate
about: idempotency
related: [idempotency, prompt-injection, budget, secret-reference, approval-gate]
---

# Webhooks and schedules for agents

Agents in production rarely start from a button. They start when something happens, through a webhook, or at a time, through a schedule. A webhook URL is a door to your agent: anyone who finds it can start runs and spend your budget. So authenticate every production webhook, prefer a signature over a bearer token, reject replayed requests, and accept an idempotency key so a retried delivery does not run the agent twice. A schedule needs answers to three questions before it goes live: which time zone, what happens when the last run is still going, and whose permissions the run uses when nobody is signed in.

## Two ways to start without a person

- **A webhook.** Another system calls your URL when something happens: a form is sent, a payment fails, a ticket arrives. The request body is the agent's input.
- **A schedule.** A clock starts the run, such as every weekday at 08:00. The input is fixed, or the agent fetches what it needs.

Both are unattended. Nobody watches the run start, nobody reads the input first, and nobody is signed in. Everything a person would have checked has to be checked by the system.

## Authenticate every webhook

There are two common ways for the caller to prove who it is.

**A bearer token.** The caller sends a shared secret in a header, `Authorization: Bearer <token>`. It is simple, and every HTTP client can do it. But the secret travels with every request, so anything that logs headers along the way (a proxy, a debugging tool) can keep a copy. And it proves only who sent the request, not that the body arrived unchanged.

**A signature.** The caller and you share a secret, but the caller never sends it. Instead it computes an HMAC, usually HMAC-SHA256, over a timestamp and the raw body, and sends the result in a header. You recompute it with your copy of the secret and compare. A changed body, a changed timestamp or a wrong secret all fail.

Prefer signatures when the caller supports them. Most payment, chat and code hosting platforms sign their webhooks this way, each with its own header names.

Here is the check in plain code:

```js
import crypto from "node:crypto";

const seen = new Map();   // signature -> expiry; use a shared store when you run more than one instance

function verifyWebhook({ rawBody, timestamp, signature, secret, toleranceSec = 300 }) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > toleranceSec) return "too old";

  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const given = String(signature).replace(/^sha256=/, "");
  const ok = given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return "bad signature";

  const now = Date.now();
  for (const [key, expiry] of seen) if (expiry < now) seen.delete(key);
  if (seen.has(given)) return "replay";
  seen.set(given, now + toleranceSec * 1000);
  return "ok";
}
```

Three details in it matter:

- **Sign the raw body**, the exact bytes received, before any JSON parsing. Parsing and re-serialising can change spacing or key order, and the signature no longer matches.
- **Compare in constant time.** A plain `===` can leak, through timing, how many leading characters matched.
- **Check the timestamp**, and include it in what is signed, so a caller cannot reuse an old signature with a fresh timestamp.

## Reject replays, and accept idempotency keys

A valid signature does not stop someone who saw a request from sending it again. Two defences, for two different problems:

**Replay protection** stops a copy of a request from being accepted twice. Reject timestamps older than a few minutes, and remember recent signatures until their timestamp would be too old anyway. A replayed request then fails one check or the other.

**Idempotency** handles the honest duplicate. A sender that timed out waiting for your answer will often deliver the same event again, with a new timestamp and a new signature. Replay protection lets that through, because it is a new request. An **idempotency key** fixes it: the sender puts a unique key for the event in a header, such as `Idempotency-Key: evt_8741`, and you keep a record per key:

- a key you have not seen: run the agent, and store the result under the key;
- the same key and the same body: return the stored result, without running again;
- the same key with a different body: refuse it, because something is wrong;
- the same key while the first run is still going: answer that it is in progress.

For an agent that can act, the second case is the one that matters. Without it, a payment provider's retry can refund an order twice ([idempotency](/glossary/idempotency)).

## Treat the payload as untrusted

A webhook body is text written by someone else, and it goes into an agent's prompt. A support ticket, an email or a form field can hold an instruction aimed at the agent ([prompt injection](/learn/security/prompt-injection)). Signing proves who sent the request, not that its content is safe.

- Give a webhook-started agent only the tools its job needs.
- Put [approvals](/learn/agents/human-in-the-loop) in front of writes, as you would for any agent that reads outside content.
- Put a [budget](/learn/operations/llm-cost-control) on the workflow. A flood of valid but useless requests is still a bill.
- Limit who can reach the URL at all, by IP range, when the sender publishes its addresses.

## Questions every schedule must answer

**Which time zone?** "08:00" means nothing without one. A schedule stored in UTC fires at 09:00 local time half the year in many places. Name the time zone, and remember that daylight saving changes can skip or repeat a local hour.

**What if the last run is still going?** A run that takes 20 minutes, on a schedule every 15, overlaps itself. Decide whether a new run should start anyway, be skipped, or wait, and check what your platform does by default.

**Whose permissions does it use?** Nobody is signed in at 08:00. The run acts as someone: the workflow's owner, a service account, or nobody in particular. That decides which tools and secrets it can reach and which rules apply. A schedule that silently runs with an admin's rights is a privilege leak; one that runs with no rights fails every morning.

**Who is told when it fails?** A schedule that fails at 03:00 fails quietly. Send failures somewhere a person looks.

**What does a missed run do?** If the server was down at 08:00, does the run happen at 08:05, or not at all? Either is fine, if it is a choice.

## Webhooks and schedules in L2M

In L2M, a **Webhook Input** node starts a workflow from `ANY /webhook/<path>` (the production URL) or `/webhook-test/<path>` (the test URL, which runs the saved draft and needs a signed-in editor or an API key). Its settings ([secure webhooks](/security/secure-webhooks)):

- **Auth Mode**: `none`, `bearer_token` or `hmac_sha256`, with the secret picked from the secret store. Saving a workflow with a public webhook that is switched on shows a warning; it never blocks the save.
- **HMAC SHA-256**: the signature is `hex(HMAC_SHA256(secret, timestamp + "." + raw_body))`, sent in `x-webhook-signature` (with or without a `sha256=` prefix) next to `x-webhook-timestamp`; both header names can be changed. A timestamp outside the tolerance window (300 seconds by default) is refused, the signature is compared in constant time, and the same signature again within the window is refused as a replay with `403`.
- **Idempotency** (off by default): when it is on, a request without the `Idempotency-Key` header (the name can be changed) gets `400`. A repeated key with the same body returns the first run's result; the same key with a different body, or while the first request is still running, gets `409`. Keys are kept for 24 hours.
- **Allowed Addresses** limits callers by IP or CIDR range, checked before the auth mode.
- App triggers for Slack, GitHub, Stripe, Telegram and Discord check each provider's own signature or token instead.

A **Schedule Trigger** node takes a cron expression and a time zone, such as `0 8 * * 1-5` in `Europe/Berlin` for 08:00 on weekdays ([Schedule Trigger](/nodes/reference/input#schedule-trigger-—-schedule-trigger)). In a deployment with several instances, only the leader fires schedules.

Both are production traffic: with a release gate they run the published version, not the draft ([release gate](/product/release-gate)). When a webhook or schedule starts a run, nobody is signed in, so tool rules evaluate the run as the workflow's owner, the person who created it, or as a viewer when that person is unknown or gone ([tool policy](/product/mcp-tool-policy#reading-the-trace)). An approval request from such a run shows **Requester unknown (automatic trigger)**, and anyone who passes the approver check may decide it ([approvals](/product/approvals)). [Budgets](/product/budgets) set to block refuse new runs from any trigger.

The [webhook agent with memory recipe](/recipes/webhook-agent-with-memory) builds a webhook-started agent, and the [scheduled monitoring agent](/learn/use-cases/scheduled-monitoring-agent) guide uses a schedule.

## Further reading

- [RFC 2104: HMAC](https://www.rfc-editor.org/rfc/rfc2104) (rfc-editor.org): keyed hashing for message authentication
- [Standard Webhooks specification](https://www.standardwebhooks.com/) (standardwebhooks.com): a common format for signed webhooks, with ids and timestamps
- [OWASP LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) (genai.owasp.org)
- Related guides: [Production checklist for AI agents](/learn/operations/production-checklist-for-ai-agents), [Least privilege for agents](/learn/security/least-privilege-for-agents), [Controlling LLM costs](/learn/operations/llm-cost-control)
- In L2M: [Secure webhooks](/security/secure-webhooks), [Network controls](/security/network-controls), [Schedule Trigger](/nodes/reference/input#schedule-trigger-—-schedule-trigger)
