import type { EditToken } from "@/modules/strummer/apply-edit";

/**
 * Try the LLM strummer/edit endpoint for a freeform prompt.
 *
 * Returns the validated EditToken list (length 0–3). Network failures and
 * non-2xx responses resolve to `[]` so the caller can transparently fall back
 * to the rule-based parser without try/catch noise.
 */
export async function classifyPromptWithLLM(prompt: string): Promise<EditToken[]> {
  try {
    const res = await fetch("/api/strummer/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { tokens?: string[] };
    if (!Array.isArray(data.tokens)) return [];
    return data.tokens as EditToken[];
  } catch {
    return [];
  }
}
