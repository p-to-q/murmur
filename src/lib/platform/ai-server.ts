type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

interface ChatParams {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

interface ChatCompletion {
  choices: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

export const ai = {
  configure() {},

  async chat(params: ChatParams): Promise<ChatCompletion> {
    const apiKey = process.env.OPENAI_API_KEY ?? process.env.AI_GATEWAY_API_KEY;
    const baseUrl =
      process.env.OPENAI_BASE_URL ??
      process.env.AI_GATEWAY_BASE_URL ??
      "https://api.openai.com/v1";

    if (!apiKey) {
      throw new Error("AI disabled: set OPENAI_API_KEY or AI_GATEWAY_API_KEY.");
    }

    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      throw new Error(`AI request failed with HTTP ${res.status}`);
    }

    return (await res.json()) as ChatCompletion;
  },
};
