import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../lib/api";
import { HomeNewCards, NEW_CARDS } from "./HomeNewCards";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, fetchTemplates: vi.fn(), useTemplate: vi.fn() };
});

const template = (id: string, name: string) => ({ id, name }) as api.TemplateListItem;
const allThree = NEW_CARDS.map((card) => template(card.templateId, card.templateName));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("HomeNewCards", () => {
  it("shows Chat agent, Automation and Ask your documents, and Start makes and opens a workflow", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchTemplates).mockResolvedValue({ templates: [template("other", "Other"), ...allThree] });
    vi.mocked(api.useTemplate).mockResolvedValue({ workflowId: "wf-new" } as Awaited<ReturnType<typeof api.useTemplate>>);
    const opened = vi.fn();
    render(<HomeNewCards projectId="p1" onWorkflowCreated={opened} />);

    const row = await screen.findByTestId("home-new");
    expect(row.querySelectorAll(".home-starter-card")).toHaveLength(3);
    expect(screen.getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent)).toEqual(["Chat agent", "Automation", "Ask your documents"]);
    await user.click(screen.getByRole("button", { name: "Start Ask your documents" }));
    expect(api.useTemplate).toHaveBeenCalledWith("builtin-rag-flow", { projectId: "p1" });
    await waitFor(() => expect(opened).toHaveBeenCalledWith("wf-new"));
  });

  it("finds a template under its name when the gallery kept an older id", async () => {
    vi.mocked(api.fetchTemplates).mockResolvedValue({ templates: [template("tpl-old-1", "MCP Agent Quickstart"), ...allThree.slice(1)] });
    render(<HomeNewCards projectId="p1" onWorkflowCreated={vi.fn()} />);
    expect(await screen.findByTestId("home-new-tpl-old-1")).toBeInTheDocument();
  });

  it("shows nothing when one of the three templates is missing or the list fails", async () => {
    vi.mocked(api.fetchTemplates).mockResolvedValue({ templates: allThree.slice(0, 2) });
    const { unmount } = render(<HomeNewCards projectId="p1" onWorkflowCreated={vi.fn()} />);
    await waitFor(() => expect(api.fetchTemplates).toHaveBeenCalled());
    expect(screen.queryByTestId("home-new")).toBeNull();
    unmount();
    vi.mocked(api.fetchTemplates).mockRejectedValue(new Error("down"));
    render(<HomeNewCards projectId="p1" onWorkflowCreated={vi.fn()} />);
    await waitFor(() => expect(api.fetchTemplates).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("home-new")).toBeNull();
  });
});
