/**
 * How long a run worked: its wall time less the time it was paused waiting for an approval. A run that paused at a
 * Human Approval, an Approval Gate or a tool approval keeps its first start when it resumes, so its wall time holds
 * the wait. The usage views report latency from this value; the run history keeps the wall time.
 */

export interface ApprovalWait {
  /** When the run paused and asked. */
  createdAt: string;
  /** When the request was decided; null while it is open. */
  decidedAt: string | null;
}

/** Milliseconds from start to end, less the time inside any approval wait (overlapping waits count once). */
export function activeDurationMs(startedAt: string, completedAt: string, waits: readonly ApprovalWait[]): number {
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  const intervals = waits
    .map((wait) => {
      const from = Date.parse(wait.createdAt);
      const decided = wait.decidedAt ? Date.parse(wait.decidedAt) : end;
      return [Math.max(start, from), Math.min(end, Number.isFinite(decided) ? decided : end)] as const;
    })
    .filter(([from, to]) => Number.isFinite(from) && to > from)
    .sort((a, b) => a[0] - b[0]);
  let waited = 0;
  let coveredTo = start;
  for (const [from, to] of intervals) {
    const begin = Math.max(from, coveredTo);
    if (to > begin) waited += to - begin;
    coveredTo = Math.max(coveredTo, to);
  }
  return Math.max(0, Math.floor(end - start - waited));
}
