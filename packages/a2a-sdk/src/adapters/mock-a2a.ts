import { randomUUID } from "node:crypto";
import { a2aPartsText, type A2AMessage, type A2ATask, type A2ATaskState } from "@ai-orchestrator/shared";
import { A2AClientError, type A2ACallContext, type A2AClientAdapter, type A2AResolvedAgent, type A2ASendResult } from "../types";

const MOCK_TASKS_KEPT = 200;

/**
 * A remote agent that never leaves the process, for samples and tests: `mock-a2a://echo` answers `Echo: <text>`,
 * `mock-a2a://ask` stops at input-required, `mock-a2a://fail` fails, and `mock-a2a://slow` stays working until
 * asked again (it completes on the second GetTask). No network, no keys.
 */
export class MockA2AAdapter implements A2AClientAdapter {
  readonly id = "mock-a2a";
  private readonly tasks = new Map<string, { task: A2ATask; polls: number }>();

  handles(cardUrl: string): boolean {
    return cardUrl.trim().toLowerCase().startsWith("mock-a2a://");
  }

  private behaviour(cardUrl: string): string {
    try {
      return new URL(cardUrl).hostname || "echo";
    } catch {
      return "echo";
    }
  }

  async resolveAgent(cardUrl: string, _context: A2ACallContext): Promise<A2AResolvedAgent> {
    const url = cardUrl.trim();
    const behaviour = this.behaviour(url);
    return {
      cardUrl: url,
      card: { name: `Mock ${behaviour} agent`, description: "An in-process A2A agent for samples and tests.", skills: [] },
      endpoint: { url, version: "1.0" }
    };
  }

  async sendMessage(agent: A2AResolvedAgent, message: A2AMessage, _context: A2ACallContext): Promise<A2ASendResult> {
    const behaviour = this.behaviour(agent.cardUrl);
    const text = a2aPartsText(message.parts);
    const id = randomUUID();
    const contextId = message.contextId ?? randomUUID();
    const status = (state: A2ATaskState, reply?: string) => ({
      state,
      ...(reply ? { message: { messageId: randomUUID(), role: "ROLE_AGENT", parts: [{ text: reply }] } } : {})
    });
    let task: A2ATask;
    if (behaviour === "fail") task = { id, contextId, status: status("TASK_STATE_FAILED", "The mock agent failed on purpose.") };
    else if (behaviour === "ask") task = { id, contextId, status: status("TASK_STATE_INPUT_REQUIRED", "Which year do you mean?") };
    else if (behaviour === "slow") task = { id, contextId, status: status("TASK_STATE_WORKING") };
    else task = { id, contextId, status: status("TASK_STATE_COMPLETED"), artifacts: [{ artifactId: "reply", name: "reply", parts: [{ text: `Echo: ${text}` }] }] };
    this.tasks.set(id, { task, polls: 0 });
    // Only the latest tasks are kept: the oldest goes once there are more than MOCK_TASKS_KEPT.
    if (this.tasks.size > MOCK_TASKS_KEPT) this.tasks.delete(this.tasks.keys().next().value as string);
    return { task };
  }

  async getTask(_agent: A2AResolvedAgent, taskId: string, _context: A2ACallContext): Promise<A2ATask> {
    const entry = this.tasks.get(taskId);
    if (!entry) throw new A2AClientError("remote", "Task not found", { code: -32001 });
    entry.polls += 1;
    if (entry.task.status.state === "TASK_STATE_WORKING" && entry.polls >= 2) {
      entry.task = { ...entry.task, status: { state: "TASK_STATE_COMPLETED" }, artifacts: [{ artifactId: "reply", parts: [{ text: "Done after a while." }] }] };
    }
    return entry.task;
  }

  async cancelTask(_agent: A2AResolvedAgent, taskId: string, _context: A2ACallContext): Promise<A2ATask | null> {
    const entry = this.tasks.get(taskId);
    if (!entry) return null;
    entry.task = { ...entry.task, status: { state: "TASK_STATE_CANCELED" } };
    return entry.task;
  }
}
