import { ALL_EDIT_TOKENS } from "./apply-edit";

/**
 * Module-level constant so the ~1200-token system prompt is allocated once
 * and eligible for LLM provider prefix caching (Anthropic cache_control,
 * DeepSeek implicit prefix match). Rebuilding it per request would defeat
 * both caching layers.
 */
export const STRUMMER_EDIT_SYSTEM_PROMPT = [
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

/**
 * The same stable system prompt in the OpenAI-compatible *content-parts* form,
 * with an Anthropic-style `cache_control: { type: "ephemeral" }` breakpoint on
 * the single large text block (#207).
 *
 * MURMUR routes the edit classifier through an OpenAI-compatible AI gateway
 * (`AI_GATEWAY_BASE_URL`), not the Anthropic SDK directly. The portable way to
 * request prompt-prefix caching across that boundary is to send the message
 * `content` as an array of typed blocks and tag the stable prefix with
 * `cache_control` — the convention gateways forward to Anthropic-backed models
 * (OpenRouter / Vercel AI Gateway / LiteLLM all accept this shape). Providers
 * that don't understand `cache_control` (e.g. DeepSeek, which does automatic
 * prefix caching anyway) simply ignore the extra field, so behavior is
 * unchanged; the only effect is that repeated edits reuse the cached ~1200-token
 * prefix when the gateway is backed by a caching provider.
 *
 * `cache_control` must ride on a content block, so this is intentionally the
 * structured form rather than the plain string above — keep the two in sync.
 */
export const STRUMMER_EDIT_SYSTEM_BLOCKS = [
  {
    type: "text" as const,
    text: STRUMMER_EDIT_SYSTEM_PROMPT,
    cache_control: { type: "ephemeral" as const },
  },
];
