import { NextRequest, NextResponse } from "next/server";
import { ai } from "@eazo/sdk";
import { ALL_EDIT_TOKENS, type EditToken } from "@/modules/strummer/apply-edit";

// Strummer prompt → EditToken classifier.
//
// We ask deepseek to choose at most 3 tokens from an explicit allowlist; we
// validate the JSON response against ALL_EDIT_TOKENS before returning, so the
// model can never push an unsanctioned mutation through the Studio UI. The
// client falls back to the rule-based parser when this endpoint is unavailable.

const TIMEOUT_MS = 8_000;

if (process.env.EAZO_PRIVATE_KEY) {
  ai.configure({ privateKey: process.env.EAZO_PRIVATE_KEY });
}

type RequestBody = { prompt?: string };

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const prompt = (body.prompt ?? "").trim().slice(0, 280);
  if (!prompt) {
    return NextResponse.json({ error: "Empty prompt" }, { status: 400 });
  }
  if (!process.env.EAZO_PRIVATE_KEY) {
    // Without a key configured we deterministically refuse, so the client
    // knows to fall back to the rule parser.
    return NextResponse.json({ tokens: [], reason: "LLM disabled" }, { status: 503 });
  }

  const system = [
    "You are the Strummer edit classifier for MURMUR, a tiny app that turns a",
    "user's hum into a short song. The user is sitting in an arrangement editor",
    "and types a freeform request to tweak the song. Your only job: map that",
    "request to at most 3 EditToken strings from the allowlist below. Return",
    "JSON only — no prose, no markdown.",
    "",
    "Allowed tokens:",
    ...ALL_EDIT_TOKENS.map((t) => `- ${t}`),
    "",
    "Response shape:",
    '{ "tokens": ["warmer", "less_drums"], "reason": "..." }',
    "",
    "Pick 1–3 tokens that best capture the user's intent. Prefer fewer tokens.",
    'If nothing in the allowlist applies, return { "tokens": [], "reason": "no match" }.',
  ].join("\n");

  try {
    const completion = await Promise.race([
      ai.chat({
        model: "deepseek.v3.1",
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 200,
      }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("LLM timeout")), TIMEOUT_MS)
      ),
    ]);

    const text = completion.choices[0]?.message?.content ?? "";
    const tokens = extractTokens(text);
    return NextResponse.json({ tokens, raw: text.slice(0, 400) });
  } catch (err) {
    console.warn("[strummer/edit] llm failed:", err);
    return NextResponse.json(
      { tokens: [], error: err instanceof Error ? err.message : "LLM error" },
      { status: 502 }
    );
  }
}

// Best-effort JSON extraction — accepts either a clean JSON blob or a markdown
// fenced block. Filters tokens against the allowlist so callers never see an
// unknown value.
function extractTokens(text: string): EditToken[] {
  if (!text) return [];
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonish = fenceMatch?.[1] ?? text;

  const firstBrace = jsonish.indexOf("{");
  const lastBrace = jsonish.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonish.slice(firstBrace, lastBrace + 1));
  } catch {
    return [];
  }

  const arr = (parsed as { tokens?: unknown }).tokens;
  if (!Array.isArray(arr)) return [];

  const allow = new Set(ALL_EDIT_TOKENS);
  return arr
    .filter((v): v is string => typeof v === "string")
    .filter((v): v is EditToken => allow.has(v as EditToken))
    .slice(0, 3);
}
