import { describe, expect, it } from "vitest";
import { activeDurationMs } from "./run-active-duration.js";

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 1, 12, 0, seconds)).toISOString();

describe("activeDurationMs", () => {
  it("is the wall time when the run never waited", () => {
    expect(activeDurationMs(at(0), at(5), [])).toBe(5000);
  });

  it("leaves out the time between asking and the decision", () => {
    expect(activeDurationMs(at(0), at(50), [{ createdAt: at(2), decidedAt: at(47) }])).toBe(5000);
  });

  it("counts overlapping waits once and clips waits to the run", () => {
    const waits = [
      { createdAt: at(10), decidedAt: at(20) },
      { createdAt: at(15), decidedAt: at(30) },
      { createdAt: at(55), decidedAt: at(70) }
    ];
    expect(activeDurationMs(at(0), at(60), waits)).toBe(60_000 - 20_000 - 5_000);
  });

  it("treats an open request as waiting until the run ended", () => {
    expect(activeDurationMs(at(0), at(10), [{ createdAt: at(4), decidedAt: null }])).toBe(4000);
  });

  it("is never negative and ignores unreadable times", () => {
    expect(activeDurationMs(at(5), at(0), [])).toBe(0);
    expect(activeDurationMs(at(0), at(10), [{ createdAt: "not a time", decidedAt: at(5) }])).toBe(10_000);
  });
});
