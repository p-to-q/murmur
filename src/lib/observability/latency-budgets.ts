/**
 * Per-component latency budgets (P50 / P95) in milliseconds.
 *
 * These are the target ceilings — not hard limits. When a component exceeds
 * its P95, the structured log gets a `budget_exceeded` flag so dashboards
 * can alert on regression without parsing raw durations.
 */

export type LatencyComponent =
  | "transcribe"
  | "transcribe.worker"
  | "transcribe.polish"
  | "music_generate"
  | "music_generate.worker"
  | "llm_edit"
  | "db.query"
  | "db.transaction";

interface Budget {
  p50: number;
  p95: number;
}

const BUDGETS: Record<LatencyComponent, Budget> = {
  "transcribe":           { p50: 8_000,   p95: 20_000  },
  "transcribe.worker":    { p50: 6_000,   p95: 16_000  },
  "transcribe.polish":    { p50: 200,     p95: 800     },
  "music_generate":       { p50: 30_000,  p95: 120_000 },
  "music_generate.worker":{ p50: 25_000,  p95: 100_000 },
  "llm_edit":             { p50: 2_000,   p95: 6_000   },
  "db.query":             { p50: 50,      p95: 200     },
  "db.transaction":       { p50: 100,     p95: 400     },
};

export function getBudget(component: LatencyComponent): Budget {
  return BUDGETS[component];
}

export interface BudgetCheck {
  component: LatencyComponent;
  durationMs: number;
  budget_exceeded: boolean;
  budget_p95: number;
}

export function checkBudget(
  component: LatencyComponent,
  durationMs: number,
): BudgetCheck {
  const budget = BUDGETS[component];
  return {
    component,
    durationMs,
    budget_exceeded: durationMs > budget.p95,
    budget_p95: budget.p95,
  };
}
