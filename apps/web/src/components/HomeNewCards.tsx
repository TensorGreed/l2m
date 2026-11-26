/**
 * Home's "New" row for people who can build: three ways to start (a chat agent, an automation, questions over
 * documents), each making a new workflow from a built-in template that runs with no key and opening it. The row
 * shows only when all three templates are there.
 */
import { useEffect, useState } from "react";
import { fetchTemplates, useTemplate as createFromTemplate, type TemplateListItem } from "../lib/api";

export interface NewCard {
  title: string;
  description: string;
  /** The built-in template's id, and its name for a gallery that kept an older id. */
  templateId: string;
  templateName: string;
}

export const NEW_CARDS: readonly NewCard[] = [
  {
    title: "Chat agent",
    description: "An agent with a chat model and two sample MCP tools.",
    templateId: "builtin-mcp-agent-quickstart-flow",
    templateName: "MCP Agent Quickstart"
  },
  {
    title: "Automation",
    description: "On a schedule, fetch orders, keep the pending ones and send a summary.",
    templateId: "builtin-starter-schedule-fetch-filter-notify",
    templateName: "Schedule: fetch, filter and notify"
  },
  {
    title: "Ask your documents",
    description: "Answer a question from a few built-in documents. Swap in your own later.",
    templateId: "builtin-rag-flow",
    templateName: "RAG Flow"
  }
];

interface HomeNewCardsProps {
  /** The project open in the studio: the new workflow goes there. */
  projectId: string;
  /** Opens the workflow the template made. */
  onWorkflowCreated: (workflowId: string) => void | Promise<void>;
}

function findTemplate(templates: readonly TemplateListItem[], card: NewCard): TemplateListItem | undefined {
  return templates.find((template) => template.id === card.templateId) ?? templates.find((template) => template.name === card.templateName);
}

export function HomeNewCards({ projectId, onWorkflowCreated }: HomeNewCardsProps) {
  const [templates, setTemplates] = useState<TemplateListItem[] | null>(null);
  const [usingId, setUsingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTemplates()
      .then((result) => {
        if (!cancelled) setTemplates(result.templates);
      })
      .catch(() => {
        // Home works without the row; New workflow and Templates are still there.
        if (!cancelled) setTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!templates) return null;
  const cards = NEW_CARDS.map((card) => ({ card, template: findTemplate(templates, card) }));
  if (cards.some((entry) => !entry.template)) return null;

  const use = async (templateId: string) => {
    setUsingId(templateId);
    setError(null);
    try {
      const created = await createFromTemplate(templateId, { projectId });
      await onWorkflowCreated(created.workflowId);
    } catch (useError) {
      setError(useError instanceof Error ? useError.message : "Could not make a workflow from this template");
    } finally {
      setUsingId(null);
    }
  };

  return (
    <section className="home-starters home-new" aria-labelledby="home-new-title" data-testid="home-new">
      <div className="home-starters-head">
        <h3 id="home-new-title" className="home-starters-title">
          New
        </h3>
        <span className="home-starters-sub">Start from a ready workflow. Each one runs with no key.</span>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="home-starters-row">
        {cards.map(({ card, template }) => (
          <article key={card.title} className="home-starter-card home-new-card" data-testid={`home-new-${template!.id}`}>
            <h4 className="home-starter-name">{card.title}</h4>
            <p className="home-starter-desc">{card.description}</p>
            <button
              type="button"
              className="pg-btn small primary"
              disabled={usingId !== null}
              aria-label={`Start ${card.title}`}
              onClick={() => void use(template!.id)}
            >
              {usingId === template!.id ? "Creating…" : "Start"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
