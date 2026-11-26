---
title: "Production checklist for AI agents"
sidebarTitle: "Production checklist"
description: "The checks to make before an AI agent runs for real: tools, approvals, limits, rules, access, tests, proof and operations, plus what to watch after launch."
level: intermediate
related: [least-privilege, approval-gate, max-iterations, budget, golden-set, release-gate, audit-log, shadow-mode]
---

# Production checklist for AI agents

An agent is ready for production when it holds only the tools its job needs, asks a person before it changes anything that matters, cannot loop or spend without end, follows rules you can read, keeps credentials out of its workflow, passes tests before each release, leaves a record you can prove, and runs on infrastructure you can restore. This page puts those checks on one list, in that order, with the reason for each. After launch, watch cost per run and how many approvals people get.

Copy the list into your release process. Every line is a yes or no.

## Tools

- **The agent has only the tools its job needs.** Every tool listed is one the model can be talked into calling, and each definition costs tokens on every call ([too many tools](/learn/agents/too-many-tools)).
- **Each tool does one job, and reads are kept apart from writes.** You can then allow one and gate the other ([designing tools for agents](/learn/agents/designing-tools-for-agents)).
- **Every server is one you trust, and someone has read its tool descriptions.** A description is text the model obeys ([MCP security risks](/learn/security/mcp-security-risks)).
- **Tool definitions are watched for changes.** A server that changes a tool after you approved it, a "rug pull", should be noticed before the next run, not after.

## People

- **Every write tool asks a person first**, unless someone you trust marked it read-only. A server's own read-only hint is a claim, not proof ([tool annotations](/learn/mcp/tool-annotations)).
- **Approvers are named, and are not the person who started the run.** Self-approval is a speed bump, not a check.
- **A timeout rejects.** Silence never means yes ([human in the loop](/learn/agents/human-in-the-loop)).
- **The approver sees the exact call**: the tool and its real arguments, not a summary the model wrote.

## Limits

- **Every agent has a step limit.** It is the simplest cap on a loop that never ends ([the agent loop in code](/learn/agents/agent-loop-in-code)).
- **A blocking budget** covers the workflow or its project. Start with a warning budget to learn real numbers, then block at a level you would accept as the worst case ([controlling LLM costs](/learn/operations/llm-cost-control)).
- **Each outside caller has its own cap**, so one busy client cannot use up everyone's budget.
- **Timeouts** on the run, and on any call to a remote agent or slow tool.

## Rules

- **Tool rules say what is allowed, denied or needs approval, and deny wins** when two rules disagree ([least privilege for agents](/learn/security/least-privilege-for-agents)).
- **New rules run in shadow mode first.** A shadow rule records what it would have done without blocking anything, so you can see what it would break before it does.
- **Outbound rules** decide which hosts agents and tools may reach. An agent that reads untrusted content and can call any URL can send your data anywhere ([the lethal trifecta](/learn/security/lethal-trifecta)).

## Access

- **Secrets live in a secret store**, never in the workflow, a prompt or the repository.
- **People get the smallest role that works**, and sign in with two-factor authentication or single sign-on ([identity for AI platforms](/learn/operations/identity-for-ai-platforms)).
- **Every webhook is authenticated**, by signature where the sender supports it, with replay checks ([webhooks and schedules](/learn/operations/webhooks-and-schedules-for-agents)).
- **Every schedule has a time zone and a known owner** whose permissions the run uses.
- **Remote agents are called with a token from the secret store**, and their answers treated as outside content ([remote agents over A2A](/learn/agents/remote-agents-over-a2a)).

## Tests

- **A golden set of known-good runs** covers the common path, the edge cases and every bug you fixed ([regression testing agents](/learn/testing/regression-testing-agents)).
- **The set is replayed after every prompt, model or tool change**, with tool answers from recordings so tests never touch real systems.
- **Only versions that passed are published.** A release gate makes it a rule, not a habit ([release gates](/learn/testing/release-gates)).

## Proof

- **An audit log you can verify**: who changed what, who approved what, and when, in a log nobody can quietly edit ([audit trails for agents](/learn/operations/audit-trails-for-agents)).
- **Signed run records**, with the public key handed to the people who will need to check them, through a channel they trust.

## Operations

- **HTTPS in front.** Session cookies and tokens travel with every request.
- **Backups, with the encryption key kept apart**, and a restore you have actually tried once. A backup stored next to its key protects nothing; a backup without its key cannot read its secrets.
- **A pinned release and an upgrade plan.** An upgrade is a decision: read the changelog, back up, then change the version ([self-hosting AI agents](/learn/operations/self-hosting-ai-agents)).

## After launch

- **Watch cost per run.** A run that suddenly costs twice as much usually means a longer loop or a bigger tool result.
- **Watch approvals per person.** If people approve everything within seconds, they have stopped reading. Narrow the gate before it becomes a rubber stamp.
- **Watch what shadow rules would have blocked**, then turn the useful ones on.
- **Feed real runs back into tests.** A run that went wrong and was fixed is the best test case you will ever get.

## Where each item lives in L2M

Every item above has a place in L2M. Most of them are optional and off until you set them up, so a simple workflow needs no configuration.

| Item | In L2M |
|---|---|
| Only the tools needed | **Tools To Include** on each MCP Tool node; [toolsets](/product/mcp-gateway#toolsets) for gateway clients |
| Definitions watched for changes | Probes and tool schema history on the [MCP server registry](/product/mcp-server-registry) |
| Write tools ask first | **Ask before write tools…** in the editor's **⋯** menu; read-only marks on a server's Tools table ([approvals](/product/approvals), [read-only classification](/product/mcp-tool-policy#read-only-classification)) |
| Named approvers, timeout rejects | Approver list, **Allow self-approval** (off by default), **Timeout outcome** (Reject by default) ([approvals](/product/approvals)) |
| Step limit | **Max Iterations** on each Agent Orchestrator and Supervisor node ([agent loop](/runtime/agent-loop)) |
| Blocking budget, per-client caps | [Budgets](/product/budgets) per deployment, project, workflow, user or MCP client, set to warn or block |
| Tool rules, deny wins, shadow mode | [MCP tool policy](/product/mcp-tool-policy): allow, deny and require-approval rules, shadow mode and safety presets added in shadow |
| Outbound rules | [Outbound URL checks](/security/outbound-url-checks) and [network controls](/security/network-controls) |
| Secrets | [The secret store](/security/secrets), encrypted at rest; nodes hold a reference, never the value |
| Roles, two-factor sign-in | [Roles, SSO and MFA](/security/auth-rbac) |
| Signed webhooks | Webhook Input **Auth Mode** `hmac_sha256` ([secure webhooks](/security/secure-webhooks)) |
| Remote agents | A2A Agent node with a token from a secret ([A2A agents](/runtime/a2a-agents)) |
| Golden set, replay, release gate | [Golden runs](/product/golden-runs), [golden sets](/product/golden-sets), [release gate](/product/release-gate) |
| Audit log, signed run records | [Audit log](/security/audit-log) and [audit bundles](/security/audit-bundles) you can verify offline |
| Backups and the master key | [Backup and recovery](/operations/backup-and-recovery) |
| Pinned release | [Verify a release](/operations/verify-a-release) |
| Cost per run, approvals | [Usage views](/product/budgets#usage-views), the Approvals inbox |
| Real runs into tests | [Production capture](/product/production-capture) |

## Further reading

- [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/) (genai.owasp.org): excessive agency, unbounded consumption and the rest of the risks this list answers
- [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) (Anthropic engineering): checkpoints and stopping conditions
- Related guides: [Self-hosting AI agents](/learn/operations/self-hosting-ai-agents), [Human in the loop](/learn/agents/human-in-the-loop), [Least privilege for agents](/learn/security/least-privilege-for-agents)
