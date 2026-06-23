import { afterEach, describe, expect, it } from "bun:test";
import {
  classifyPromptWithLLM,
  StrummerEditRequestError,
} from "@/lib/api/strummer";

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("classifyPromptWithLLM typed error mapping", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns validated edit tokens on success", async () => {
    let receivedHeaders: HeadersInit | undefined;
    globalThis.fetch = (async (_input, init) => {
      receivedHeaders = init?.headers;
      return jsonResponse({
        tokens: ["warmer", "not_allowed", "less_drums", "more_bass", "more_strings"],
      });
    }) as typeof fetch;

    const tokens = await classifyPromptWithLLM("make it warmer");

    expect(tokens).toEqual(["warmer", "less_drums", "more_bass"]);
    expect(receivedHeaders).toEqual({ "Content-Type": "application/json" });
  });

  it("keeps the local no-key fallback as an empty token result", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ tokens: [], reason: "LLM disabled", requestId: "req_disabled" }, 503)
    ) as typeof fetch;

    await expect(classifyPromptWithLLM("make it warmer")).resolves.toEqual([]);
  });

  it("maps 402 insufficient_notes into a typed error with balance and cost", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(
        {
          error: "insufficient_notes",
          message: "Not enough Murmur Notes",
          requestId: "req_402",
          currentBalance: 0,
          cost: 1,
        },
        402,
      )
    ) as typeof fetch;

    try {
      await classifyPromptWithLLM("more strings");
      throw new Error("expected classifyPromptWithLLM to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(StrummerEditRequestError);
      const typed = error as StrummerEditRequestError;
      expect(typed.code).toBe("insufficient_notes");
      expect(typed.status).toBe(402);
      expect(typed.requestId).toBe("req_402");
      expect(typed.currentBalance).toBe(0);
      expect(typed.cost).toBe(1);
    }
  });

  it("preserves billing_unavailable so Studio does not blame the prompt", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(
        {
          error: "billing_unavailable",
          message: "User balance is unavailable",
          requestId: "req_billing",
        },
        503,
      )
    ) as typeof fetch;

    try {
      await classifyPromptWithLLM("more strings");
      throw new Error("expected classifyPromptWithLLM to throw");
    } catch (error) {
      const typed = error as StrummerEditRequestError;
      expect(typed.code).toBe("billing_unavailable");
      expect(typed.status).toBe(503);
      expect(typed.requestId).toBe("req_billing");
    }
  });

  it("maps rate limits into a typed recovery code", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ error: "rate_limited", requestId: "req_rate" }, 429)
    ) as typeof fetch;

    try {
      await classifyPromptWithLLM("more strings");
      throw new Error("expected classifyPromptWithLLM to throw");
    } catch (error) {
      const typed = error as StrummerEditRequestError;
      expect(typed.code).toBe("rate_limited");
      expect(typed.status).toBe(429);
      expect(typed.requestId).toBe("req_rate");
    }
  });

  it("maps LLM failures into llm_unavailable", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ error: "LLM timeout", requestId: "req_llm" }, 502)
    ) as typeof fetch;

    try {
      await classifyPromptWithLLM("more strings");
      throw new Error("expected classifyPromptWithLLM to throw");
    } catch (error) {
      const typed = error as StrummerEditRequestError;
      expect(typed.code).toBe("llm_unavailable");
      expect(typed.status).toBe(502);
      expect(typed.requestId).toBe("req_llm");
    }
  });

  it("wraps low-level fetch failures as network_error", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;

    try {
      await classifyPromptWithLLM("more strings");
      throw new Error("expected classifyPromptWithLLM to throw");
    } catch (error) {
      const typed = error as StrummerEditRequestError;
      expect(typed.code).toBe("network_error");
      expect(typed.status).toBe(0);
    }
  });
});
