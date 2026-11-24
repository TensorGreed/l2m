import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RunInputPopover } from "./RunInputPopover";

const empty = { prompt: "", systemPrompt: "" };

describe("RunInputPopover", () => {
  it("renders nothing for a workflow that reads no prompt", () => {
    const { container } = render(
      <RunInputPopover value={empty} onChange={vi.fn()} fields={{ prompt: false, systemPrompt: false }} open={false} onOpenChange={vi.fn()} onRun={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when only the system prompt would apply (a prompt node with text supplies the prompt)", () => {
    const { container } = render(
      <RunInputPopover value={empty} onChange={vi.fn()} fields={{ prompt: false, systemPrompt: true }} open={false} onOpenChange={vi.fn()} onRun={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the input next to Run, 'none' while empty", () => {
    render(<RunInputPopover value={empty} onChange={vi.fn()} fields={{ prompt: true, systemPrompt: false }} open={false} onOpenChange={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByTestId("run-input-toggle").textContent).toContain("none");
  });

  it("edits the prompt and runs with it", () => {
    const onChange = vi.fn();
    const onRun = vi.fn();
    render(
      <RunInputPopover value={{ prompt: "hi", systemPrompt: "" }} onChange={onChange} fields={{ prompt: true, systemPrompt: true }} open onOpenChange={vi.fn()} onRun={onRun} asked />
    );
    expect(screen.getByText(/works on a prompt/)).toBeTruthy();
    fireEvent.change(screen.getByTestId("run-input-prompt"), { target: { value: "What is MCP?" } });
    expect(onChange).toHaveBeenCalledWith({ prompt: "What is MCP?", systemPrompt: "" });
    fireEvent.change(screen.getByTestId("run-input-system"), { target: { value: "Be brief" } });
    expect(onChange).toHaveBeenLastCalledWith({ prompt: "hi", systemPrompt: "Be brief" });
    fireEvent.click(screen.getByTestId("run-input-run"));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("does not run when Run is off for you", () => {
    const onRun = vi.fn();
    render(
      <RunInputPopover value={empty} onChange={vi.fn()} fields={{ prompt: true, systemPrompt: false }} open onOpenChange={vi.fn()} onRun={onRun} runDisabledReason="Running needs the builder role" />
    );
    fireEvent.click(screen.getByTestId("run-input-run"));
    expect(onRun).not.toHaveBeenCalled();
  });
});
