import "server-only";
import { createPartFromUri, GoogleGenAI, type Part } from "@google/genai";
import { env, geminiModel } from "@/lib/env";

/** Deck content ready for the model. */
export type DeckInput =
  | { kind: "pdf"; data: Buffer; fileName: string }
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
    public code: "not_configured" | "empty" | "blocked" | "cancelled" | "failed",
    message: string,
  ) {
    super(message);
  }
}

const INLINE_LIMIT = 19 * 1024 * 1024; // Gemini inline request limit is ~20 MB

class GeminiProvider implements AiProvider {
  private ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  async generateJson({ system, prompt, deck, jsonSchema, signal }: GenerateRequest): Promise<string> {
    let uploadedName: string | null = null;
    try {
      const parts: Part[] = [];
      if (deck.kind === "pdf") {
        if (deck.data.length <= INLINE_LIMIT) {
          parts.push({ inlineData: { mimeType: "application/pdf", data: deck.data.toString("base64") } });
        } else {
          const blob = new Blob([new Uint8Array(deck.data)], { type: "application/pdf" });
          let f = await this.ai.files.upload({ file: blob, config: { mimeType: "application/pdf" } });
          uploadedName = f.name ?? null;
          for (let i = 0; f.state === "PROCESSING" && i < 60; i++) {
            if (signal?.aborted) throw new AiError("cancelled", "Cancelled");
            await new Promise((r) => setTimeout(r, 2000));
            f = await this.ai.files.get({ name: f.name! });
          }
          if (f.state !== "ACTIVE" || !f.uri) throw new AiError("failed", "The deck could not be prepared for reading.");
          parts.push(createPartFromUri(f.uri, "application/pdf"));
        }
      }
      parts.push({ text: prompt });

      const res = await this.ai.models.generateContent({
        model: geminiModel,
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: system,
          responseMimeType: "application/json",
          responseJsonSchema: jsonSchema,
          temperature: 0.2,
          abortSignal: signal,
        },
      });
      if (res.promptFeedback?.blockReason) throw new AiError("blocked", "The model declined to read this deck.");
      const text = res.text;
      if (!text) throw new AiError("empty", "The summary came back empty.");
      return text;
    } catch (e) {
      if (signal?.aborted) throw new AiError("cancelled", "Cancelled");
      throw e;
    } finally {
      // Files API keeps uploads for 48 h by default; remove NDA material straight away.
      if (uploadedName) await this.ai.files.delete({ name: uploadedName }).catch(() => undefined);
    }
  }
}

let provider: AiProvider | null = null;

export function aiProvider(): AiProvider {
  if (!env.GEMINI_API_KEY) {
    throw new AiError("not_configured", "AI summaries are not set up yet. Add a paid GEMINI_API_KEY to enable them.");
  }
  provider ??= new GeminiProvider();
  return provider;
}
