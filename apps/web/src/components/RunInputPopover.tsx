/**
 * The editor's Run input, next to Run: what a Run sends as the prompt (`{{user_prompt}}`) and, when the workflow reads
 * one, the system prompt. Shown only for workflows that read the run's prompt (a workflow whose prompt node has text
 * does not); remembered per workflow in this browser.
 */
import { useEffect, useId, useRef } from "react";
import { RUN_INPUT_MAX_CHARS, type RunInput } from "../lib/run-input";

interface RunInputPopoverProps {
  value: RunInput;
  onChange: (next: RunInput) => void;
  /** The fields the workflow reads. */
  fields: { prompt: boolean; systemPrompt: boolean };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs with the input (and closes the popover). */
  onRun: () => void;
  /** Why Run is off for you. */
  runDisabledReason?: string | null;
  busy?: boolean;
  /** Run opened it because the workflow has nothing to work on without a prompt. */
  asked?: boolean;
  /** The prompt the workflow's Manual Trigger test data supplies, which a Run with an empty Input uses. */
  samplePrompt?: string;
}

function preview(text: string): string {
  const flat = text.trim().replace(/\s+/g, " ");
  return flat.length > 28 ? `${flat.slice(0, 27)}…` : flat;
}

export function RunInputPopover({ value, onChange, fields, open, onOpenChange, onRun, runDisabledReason, busy = false, asked = false, samplePrompt }: RunInputPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const promptId = useId();
  const systemId = useId();

  useEffect(() => {
    if (!open) return;
    promptRef.current?.focus();
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onOpenChange(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  // Shown for workflows that read the run's prompt; the system prompt is an optional extra there.
  if (!fields.prompt) return null;
  const shown = value.prompt;
  const empty = !shown.trim();
  const sample = samplePrompt?.trim() ? samplePrompt : undefined;

  return (
    <div className="hud-menu run-input" ref={ref}>
      <button
        type="button"
        className={`hud-pill hud-btn run-input-toggle${empty && !sample ? " is-empty" : ""}`}
        onClick={() => onOpenChange(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="run-input-toggle"
        title={
          !empty ? `Run input: ${shown}` : sample ? `Run uses the Manual Trigger's test data: ${sample}` : "Type the input this workflow's Run sends"
        }
      >
        <span className="run-input-label">Input</span>
        <span className="run-input-preview" data-testid="run-input-preview">
          {!empty ? preview(shown) : sample ? `sample: ${preview(sample)}` : "none"}
        </span>
      </button>
      {open && (
        <div className="hud-dropdown run-input-popover" role="dialog" aria-label="Run input" data-testid="run-input-popover">
          {asked && <p className="run-input-ask">This workflow works on a prompt. Type one to run it with.</p>}
          <label className="run-input-field" htmlFor={promptId}>
            <span>Prompt</span>
            <textarea
              id={promptId}
              ref={promptRef}
              rows={3}
              maxLength={RUN_INPUT_MAX_CHARS}
              value={value.prompt}
              placeholder={sample ? `Empty: Run uses the Manual Trigger's test data, "${sample}"` : "What should the workflow work on?"}
              data-testid="run-input-prompt"
              onChange={(event) => onChange({ ...value, prompt: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !runDisabledReason && !busy) {
                  event.preventDefault();
                  onRun();
                }
              }}
            />
          </label>
          {fields.systemPrompt && (
            <label className="run-input-field" htmlFor={systemId}>
              <span>System prompt (optional)</span>
              <textarea
                id={systemId}
                rows={2}
                maxLength={RUN_INPUT_MAX_CHARS}
                value={value.systemPrompt}
                placeholder="Instructions for the model, if the workflow does not set its own"
                data-testid="run-input-system"
                onChange={(event) => onChange({ ...value, systemPrompt: event.target.value })}
              />
            </label>
          )}
          <p className="run-input-hint">
            Sent with Run as {"{{user_prompt}}"}; nothing is sent while it is empty. Webhook run sends its own payload
            instead. Remembered for this workflow in this browser.
          </p>
          <div className="run-input-actions">
            <button type="button" className="pg-btn" onClick={() => onChange({ prompt: "", systemPrompt: "" })} disabled={empty && !value.systemPrompt.trim()}>
              Clear
            </button>
            <button
              type="button"
              className="pg-btn primary"
              data-testid="run-input-run"
              onClick={runDisabledReason ? undefined : onRun}
              disabled={busy}
              aria-disabled={runDisabledReason ? true : undefined}
              title={runDisabledReason ?? "Run with this input (Ctrl+Enter)"}
            >
              Run
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
