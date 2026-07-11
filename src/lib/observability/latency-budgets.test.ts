import { describe, expect, it } from "bun:test";
import {
  checkBudget,
  getBudget,
  type LatencyComponent,
} from "./latency-budgets";

const ALL_COMPONENTS: LatencyComponent[] = [
  "transcribe",
  "transcribe.worker",
  "transcribe.polish",
  "music_generate",
  "music_generate.worker",
  "llm_edit",
  "db.query",
  "db.transaction",
];

describe("getBudget", () => {
  it("returns a sane p50 < p95 budget for every component", () => {
    for (const component of ALL_COMPONENTS) {
      const budget = getBudget(component);
      expect(budget.p50).toBeGreaterThan(0);
      expect(budget.p95).toBeGreaterThan(budget.p50);
    }
  });

  it("keeps sub-component budgets inside their parent budget", () => {
    expect(getBudget("transcribe.worker").p95).toBeLessThan(getBudget("transcribe").p95);
    expect(getBudget("music_generate.worker").p95).toBeLessThan(getBudget("music_generate").p95);
  });
});

describe("checkBudget", () => {
  it("does not flag a duration at or below the p95 ceiling", () => {
    const p95 = getBudget("llm_edit").p95;
    expect(checkBudget("llm_edit", p95).budget_exceeded).toBe(false);
    expect(checkBudget("llm_edit", 0).budget_exceeded).toBe(false);
  });

  it("flags a duration above the p95 ceiling", () => {
    const p95 = getBudget("llm_edit").p95;
    const check = checkBudget("llm_edit", p95 + 1);
    expect(check.budget_exceeded).toBe(true);
    expect(check.budget_p95).toBe(p95);
    expect(check.durationMs).toBe(p95 + 1);
    expect(check.component).toBe("llm_edit");
  });

  it("echoes the component and duration for log spreading", () => {
    const check = checkBudget("db.query", 37);
    expect(check).toEqual({
      component: "db.query",
      durationMs: 37,
      budget_exceeded: false,
      budget_p95: getBudget("db.query").p95,
    });
  });
});
