---
title: "NIST AI RMF vs ISO 42001: what is the difference?"
sidebarTitle: "NIST AI RMF vs ISO 42001"
description: "NIST AI RMF is a free, voluntary risk framework; ISO/IEC 42001 is a certifiable AI management system standard. How they differ and how to use both."
level: intermediate
about: nist-ai-rmf
related: [nist-ai-rmf, iso-42001, eu-ai-act, audit-log, eval]
---

# NIST AI RMF vs ISO/IEC 42001

The <Term id="nist-ai-rmf">NIST AI Risk Management Framework</Term> (NIST AI 100-1) is a free, voluntary guide to finding and managing the risks of AI systems, organised in four functions: Govern, Map, Measure and Manage. <Term id="iso-42001">ISO/IEC 42001</Term> is an international standard for an AI management system: the policies, processes and reviews an organisation runs around AI, which an accredited body can audit and certify. The NIST framework tells you what good AI risk work looks like; ISO/IEC 42001 gives you a management system you can prove to an auditor. You can use the first to shape the work and the second to run and evidence it.

## NIST AI RMF in one page

NIST released AI RMF 1.0 on 26 January 2023 as NIST AI 100-1. The document says it is "intended to be voluntary, rights-preserving, non-sector-specific, and use-case agnostic". It is free to download, and nobody certifies against it.

It has two parts.

**Part 1** frames AI risk and describes what a trustworthy AI system is. It names seven characteristics: valid and reliable; safe; secure and resilient; accountable and transparent; explainable and interpretable; privacy-enhanced; and fair with harmful bias managed.

**Part 2, the Core**, describes four functions, each broken into categories and subcategories:

- **Govern** sets up a culture of risk management: policies, roles, accountability. NIST calls it "a cross-cutting function" that informs the other three.
- **Map** establishes the context: what the system is for, who it affects, and which risks follow.
- **Measure** uses "quantitative, qualitative, or mixed-method tools" to analyse, assess, benchmark and monitor those risks. NIST says AI systems "should be tested before their deployment and regularly while in operation."
- **Manage** allocates resources to the mapped and measured risks and plans how to respond to, recover from and communicate about incidents.

The Core is not a checklist. In NIST's words, the actions "do not constitute a checklist, nor are they necessarily an ordered set of steps". Organisations pick the categories that fit them. They can also write **profiles**: a current profile and a target profile for one use case, compared to find the gaps.

Three companions sit next to the framework:

- **The Playbook**, an online resource of suggested actions for each subcategory. Like the framework, it is voluntary.
- **The Generative AI Profile** (NIST AI 600-1, released 26 July 2024), which applies the framework to risks specific to generative AI.
- **Crosswalks**, which map the framework to other documents. NIST's crosswalk list includes one to ISO/IEC 42001, provided by Microsoft and drawn up against the final draft (FDIS) of the standard.

NIST's AI RMF page also says that AI RMF 1.0 "is being revised as part of the White House AI Action Plan". Check the page for the current version before you cite one.

## ISO/IEC 42001 in one page

ISO/IEC 42001:2023 was published in December 2023 by ISO/IEC JTC 1/SC 42, the joint ISO and IEC committee on artificial intelligence. Its abstract says it "specifies the requirements and provides guidance for establishing, implementing, maintaining and continually improving an AI (artificial intelligence) management system within the context of an organization". It is meant for any organisation, of any size, that provides or uses products or services that use AI systems.

Three things set it apart from the NIST framework.

**It is a management system standard.** ISO describes 42001 as a management system standard (MSS) and says that implementing it "means putting in place policies and procedures for the sound governance of an organization in relation to AI, using the Plan-Do-Check-Act methodology". It is about how the organisation runs AI, not about the details of one model: rather than looking at specific AI applications, ISO says, it "provides a practical way of managing AI-related risks and opportunities across an organization". ISO also sells it in a package with ISO/IEC 27001, the information security management system standard.

**It is certifiable.** ISO/IEC 42006:2025, published in July 2025, sets the requirements for bodies that audit and certify an AI management system against ISO/IEC 42001. It describes that certification as "a third-party conformity assessment activity". So an organisation can be audited and hold a certificate; with the NIST framework there is nothing to certify against.

**It is a paid standard.** The text is sold by ISO and IEC, so this page describes it only from their public pages. The NIST-listed crosswalk gives an idea of its contents: it maps NIST subcategories to clauses of the draft such as "AI risk assessment", "AI risk treatment" and "AI system impact assessment", and to implementation guidance on topics such as the AI policy and AI roles and responsibilities. For exact clauses and controls, read the standard itself.

## Side by side

| | NIST AI RMF (AI 100-1) | ISO/IEC 42001:2023 |
|---|---|---|
| Publisher | NIST, US Department of Commerce | ISO and IEC (JTC 1/SC 42) |
| Published | January 2023 | December 2023 |
| What it is | A risk management framework | A management system standard with requirements |
| Binding? | Voluntary | Voluntary, unless a contract or customer asks for it |
| Certification | None | Third-party certification by certification bodies (ISO/IEC 42006 sets their requirements) |
| Structure | Four functions (Govern, Map, Measure, Manage), categories, subcategories | Plan-Do-Check-Act management system |
| Focus | Risks of AI systems and their trustworthiness | How an organisation governs its AI work |
| Cost | Free | Paid standard; certification audits cost extra |
| Companions | Playbook, Generative AI Profile (AI 600-1), crosswalks | Related ISO/IEC standards, such as ISO/IEC 23894 on AI risk management and ISO/IEC 42006 on certification |
| What you can show others | Your own profile and documentation | A certificate from an audit |

## A concrete example

Take one team that runs a customer support agent with access to an order system and a refund tool.

**With the NIST AI RMF**, the team works through the functions for that agent. *Map*: the agent answers customers and can issue refunds, so the risks include wrong refunds, leaked order data and misleading answers. *Measure*: a set of test conversations run before every release, with refund accuracy and the rate of unsupported claims tracked over time. *Manage*: refunds above a threshold need a person's approval, and there is a plan for what happens when the agent gives a wrong answer at scale. *Govern*: someone owns the agent, and the policy says who may change its prompt or tools. The output is the team's own documentation and a target profile.

**With ISO/IEC 42001**, the same work becomes part of an organisation-wide system. The organisation sets an AI policy and objectives, assigns roles, runs risk and impact assessments for each AI system (the support agent is one of them), keeps documented information, monitors and audits the system, and reviews it at management level. An external auditor checks that the system exists and that it runs as documented. The output is a certificate that customers and partners can rely on.

The engineering underneath is the same in both: tests before release, approvals on risky actions, records of what the agent did. What differs is the wrapper. The framework helps you decide what to do. The standard requires you to run it as a repeatable process and to prove it.

## Which to use when

**Start with the NIST AI RMF when:**

- you want a free, detailed vocabulary for AI risk and you are just starting;
- you need to think through one system's risks in depth, especially a generative AI system (use the AI 600-1 profile);
- nobody is asking you for a certificate.

**Choose ISO/IEC 42001 when:**

- customers, partners or procurement teams ask for evidence of AI governance from a third party;
- you already run ISO management systems, such as ISO/IEC 27001, and want AI in the same audit cycle;
- you need governance that covers every AI system in the organisation, not one at a time.

**Use both when** you want certification and practical depth. One way to combine them is to run the ISO/IEC 42001 management system as the frame and use the NIST functions, Playbook actions and profiles as the method inside its risk assessment and treatment steps. The NIST crosswalks make the mapping easier.

## Neither one is the law

Both are voluntary. Neither is the <Term id="eu-ai-act">EU AI Act</Term>, and following either does not by itself show that a system meets that Act's requirements. They help with the same kinds of work the Act asks for, such as risk management, documentation and human oversight. See [EU AI Act risk categories](/learn/governance/eu-ai-act-risk-levels) for how the Act classifies systems.

## Further reading

- [AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework) (NIST): the framework, the Playbook, the Generative AI Profile and the revision notice
- [NIST AI 100-1, AI RMF 1.0](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf) (NIST): the full framework
- [NIST AI 600-1, Generative AI Profile](https://doi.org/10.6028/NIST.AI.600-1) (NIST)
- [Crosswalks to the AI RMF](https://airc.nist.gov/AI_RMF_Knowledge_Base/Crosswalks) (NIST AI Resource Center), including the ISO/IEC 42001 crosswalk
- [ISO/IEC 42001:2023, AI management systems](https://www.iso.org/standard/42001) (ISO)
- [ISO/IEC 42006:2025, requirements for AI management system audit and certification bodies](https://webstore.iec.ch/en/publication/108460) (IEC webstore)
- Related guides: [EU AI Act risk categories](/learn/governance/eu-ai-act-risk-levels), [Audit trails for AI agents](/learn/operations/audit-trails-for-agents), [Agent evals](/learn/testing/agent-evals), [Human in the loop](/learn/agents/human-in-the-loop)
