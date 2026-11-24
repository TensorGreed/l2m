import { useState } from "react";
import { previewA2ACard, type A2ACardPreview } from "../lib/api";
import { CopyButton } from "./McpToolsetsView";

/** The URLs an Expose as A2A Agent trigger serves: the Agent Card (what callers are given) and its JSON-RPC endpoint. */
export function a2aAgentUrls(apiBase: string, path: string): { card: string; endpoint: string } | null {
  const clean = path.trim().replace(/^\/+|\/+$/g, "");
  if (!clean) return null;
  const endpoint = `${apiBase.replace(/\/+$/, "")}/a2a/${encodeURIComponent(clean)}`;
  return { card: `${endpoint}/.well-known/agent-card.json`, endpoint };
}

export function A2AAgentUrls({ apiBase, path, authMode }: { apiBase: string; path: string; authMode: string }) {
  const urls = a2aAgentUrls(apiBase, path);
  if (!urls) return <div className="cfg-tip">Set an Agent Path to get this agent's URL.</div>;
  return (
    <div className="cfg-tip" data-testid="a2a-agent-urls">
      <div>
        <strong>Agent Card URL</strong> (give this to the calling agent)
      </div>
      <code>{urls.card}</code> <CopyButton text={urls.card} ariaLabel="Copy the Agent Card URL" />
      <div style={{ marginTop: "8px" }}>
        <strong>JSON-RPC endpoint</strong>
      </div>
      <code>{urls.endpoint}</code>
      <div style={{ marginTop: "6px" }}>
        {authMode === "public"
          ? "Anyone with the URL can send it tasks."
          : authMode === "bearer"
            ? "Callers send the token from the secret below in Authorization: Bearer."
            : "Callers send an L2M API key (operator or above, allowed to run this workflow) in Authorization: Bearer."}{" "}
        Production runs the published version (or the draft when nothing is published). The card itself is public.
      </div>
    </div>
  );
}

/** "Check agent": reads the remote card through the server (outbound URL rules apply) and shows what it offers. */
export function A2AAgentCardCheck({ cardUrl }: { cardUrl: string }) {
  const [state, setState] = useState<{ status: "idle" | "loading" } | { status: "ok"; card: A2ACardPreview; url: string } | { status: "error"; message: string }>({
    status: "idle"
  });
  const target = cardUrl.trim();
  const check = async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "ok", card: await previewA2ACard(target), url: target });
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : "The agent card could not be read" });
    }
  };
  const isRemote = /^https?:\/\//i.test(target);
  return (
    <div className="cfg-field" data-testid="a2a-card-check">
      <div>
        <button type="button" className="pg-btn small" disabled={!isRemote || state.status === "loading"} onClick={() => void check()}>
          {state.status === "loading" ? "Checking…" : "Check agent"}
        </button>
      </div>
      {state.status === "error" ? (
        <div className="cfg-tip cfg-legacy" role="alert">
          {state.message}
        </div>
      ) : null}
      {state.status === "ok" && state.url === target ? (
        <div className="cfg-tip" data-testid="a2a-card-preview">
          <div>
            <strong>{state.card.name}</strong>
            {state.card.version ? ` v${state.card.version}` : ""} · A2A {state.card.protocolVersion}
            {state.card.securitySchemes.length > 0 ? " · needs a token" : ""}
          </div>
          {state.card.description ? <div>{state.card.description}</div> : null}
          {state.card.skills.length > 0 ? (
            <ul style={{ margin: "6px 0 0", paddingLeft: "18px" }}>
              {state.card.skills.slice(0, 8).map((skill) => (
                <li key={skill.id || skill.name}>
                  <strong>{skill.name || skill.id}</strong>
                  {skill.description ? `: ${skill.description}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
