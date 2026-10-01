import "server-only";
import { aiConfigured, aiModel, env } from "@/lib/env";

/** Deck content ready for the model. `text` is the deck's own text (PDF text layer or slide text). */
export type DeckInput =
  | { kind: "pdf"; data: Buffer; fileName: string; text: string }
  | { kind: "text"; text: string; fileName: string };

export interface GenerateRequest {
  system: string;
  prompt: string;
  deck: DeckInput;
  jsonSchema: unknown;
  signal?: AbortSignal;
}

/** Swappable model backend (SPEC §2). Returns the raw JSON text. */
export interface AiProvider {
  generateJson(req: GenerateRequest): Promise<string>;
}

export class AiError extends Error {
  constructor(
    public code: "not_configured" | "empty" | "blocked" | "cancelled" | "no_credits" | "failed",
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "file"; file: { filename: string; file_data: string } };

/** OpenRouter chat completions (SPEC §2, §9, §13). Never logs deck content. */
class OpenRouterProvider implements AiProvider {
  async generateJson({ system, prompt, deck, jsonSchema, signal }: GenerateRequest): Promise<string> {
    const content: ContentPart[] = [];
    if (deck.kind === "pdf") {
      content.push({
        type: "file",
        file: { filename: deck.fileName.replace(/\.pptx$/i, ".pdf"), file_data: "data:application/pdf;base64," + deck.data.toString("base64") },
      });
    }
    content.push({ type: "text", text: prompt }); // includes the deck's text layer (see prompt.ts)

    let res: Response;
    try {
      res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "X-Title": "Niveshaay Deal Pipeline",
        },
        body: JSON.stringify({
          model: aiModel,
          temperature: 0.2,
          messages: [
            { role: "system", content: system },
            { role: "user", content },
          ],
          response_format: { type: "json_schema", json_schema: { name: "deck_summary", strict: true, schema: jsonSchema } },
          // NDA decks: only providers that don't store or train on prompts, and that support the schema.
          provider: { data_collection: "deny", require_parameters: true },
          plugins: [{ id: "file-parser", pdf: { engine: "native" } }],
        }),
      });
    } catch (e) {
      if (signal?.aborted) throw new AiError("cancelled", "Cancelled");
      throw e;
    }

    const body = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string | null }; finish_reason?: string }[];
      error?: { code?: number };
    } | null;
    if (res.status === 402) throw new AiError("no_credits", "The AI account is out of credits. Top up OpenRouter and generate again.", 402);
    if (!res.ok || body?.error) {
      throw new AiError("failed", "The summary could not be written. Try generating it again.", body?.error?.code ?? res.status);
    }
    const text = body?.choices?.[0]?.message?.content;
    if (body?.choices?.[0]?.finish_reason === "content_filter") throw new AiError("blocked", "The model declined to read this deck.");
    if (!text) throw new AiError("empty", "The summary came back empty.");
    return text;
  }
}

let provider: AiProvider | null = null;

export function aiProvider(): AiProvider {
  if (!aiConfigured) {
    throw new AiError("not_configured", "AI summaries are not set up yet. Add an OPENROUTER_API_KEY to enable them.");
  }
  provider ??= new OpenRouterProvider();
  return provider;
}
