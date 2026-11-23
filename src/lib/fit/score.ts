import "server-only";
import { z } from "zod";
import { aiProvider } from "@/lib/ai/provider";
import { fitModel } from "@/lib/env";
import { agree, hasBannedWord, type FitParam, type Quote, type ScoreRow } from "@/lib/domain/fit";

// Step 2 of the fit rating (SPEC §17.7): two separate text-only calls per DECK parameter that has quotes, compared by
// code. A parameter with no quotes is blank without a call. Never log the quotes, the prompt or the answer.

export interface AnchorLite {
  code: string;
  score: number;
  label: string;
  shows: string;
}

const MAX_WHY_WORDS = 25;

const SYSTEM = [
  "You score one question about a company for a private equity fund's ranking, using only the quotes from its deck that are given to you.",
  "Score proof, not claims: a claim with no number, name or date behind it cannot score above 3.",
  "Compare with the anchors, which show what each score looks like at named companies, and give the score of the anchor the company sits closest to. Do not invent your own scale.",
  "If the quotes do not answer the question, the score is null.",
  `why: one plain sentence, at most ${MAX_WHY_WORDS} words, on what in the quotes sets the score. Never use the words invest, pass, reject, recommend, buy or avoid, in any form. Do not give advice; describe the evidence.`,
].join("\n");

const answer = z.object({ score: z.number().int().min(1).max(5).nullable(), anchor: z.string().nullable(), why: z.string() });
type Answer = z.infer<typeof answer>;

function schema(anchors: AnchorLite[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["score", "anchor", "why"],
    properties: {
      // anyOf, not a mixed-type enum: Anthropic's structured output refuses an enum that mixes null with values.
      score: { anyOf: [{ type: "integer", enum: [1, 2, 3, 4, 5] }, { type: "null" }] },
      anchor: anchors.length ? { anyOf: [{ type: "string", enum: anchors.map((a) => a.code) }, { type: "null" }] } : { type: "null" },
      why: { type: "string" },
    },
  };
}

const quoteLines = (qs: Quote[]) => qs.map((q) => `- "${q.text}"${q.page ? ` (page ${q.page})` : ""}`);

function prompt(param: FitParam, anchors: AnchorLite[], quotes: Quote[], extra: Quote[], business: string[]): string {
  return [
    `Question ${param.code}, ${param.name}: ${param.question}`,
    "",
    "Anchors (code, score, company, what it shows):",
    ...(anchors.length ? anchors.map((a) => `${a.code} | ${a.score} | ${a.label} | ${a.shows}`) : ["none yet: use the rule on proof and claims only"]),
    "",
    "Quotes from the deck:",
    ...quoteLines(quotes),
    ...(extra.length ? ["", "The deck also says the company is a qualified or approved vendor:", ...quoteLines(extra)] : []),
    ...(business.length ? ["", "What the company does (from the deck summary, for context only, not evidence):", ...business.map((b) => `- ${b}`)] : []),
  ].join("\n");
}

/** One reading. A `why` with a banned word is thrown away and the call made again once; then the why is left empty. */
async function reading(req: Parameters<ReturnType<typeof aiProvider>["generateJson"]>[0], anchors: AnchorLite[]): Promise<Answer> {
  const ask = async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = answer.safeParse(JSON.parse(await aiProvider().generateJson(req)));
        if (r.success) return r.data;
      } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
      }
    }
    throw new Error("invalid_json");
  };
  let a = await ask();
  if (hasBannedWord(a.why)) {
    a = await ask();
    if (hasBannedWord(a.why)) a = { ...a, why: "" };
  }
  const anchor = a.anchor && anchors.some((x) => x.code === a.anchor) ? a.anchor : null;
  return { ...a, anchor, why: a.why.trim().split(/\s+/).slice(0, MAX_WHY_WORDS * 2).join(" ") };
}

/** Scores one DECK parameter from its quotes (two readings, agreement by code). */
export async function scoreParameter(param: FitParam, anchors: AnchorLite[], quotes: Quote[], opts: { qualification?: Quote[]; business?: string[]; signal?: AbortSignal } = {}): Promise<ScoreRow> {
  if (!quotes.length) return { code: param.code, score: null, anchor: null, why: "", readings: [], agreed: true, blank: "NOT_IN_DECK" };
  const req = {
    system: SYSTEM,
    prompt: prompt(param, anchors, quotes, opts.qualification ?? [], opts.business ?? []),
    jsonSchema: schema(anchors),
    model: fitModel,
    maxTokens: 600,
    signal: opts.signal,
  };
  const [a, b] = await Promise.all([reading(req, anchors), reading(req, anchors)]);
  const g = agree(a.score, b.score);
  // The reading whose score stands gives the anchor and the why (the lower one when they are one apart).
  const lead = g.score === null ? null : a.score === g.score ? a : b;
  return { code: param.code, score: g.score, anchor: lead?.anchor ?? null, why: lead?.why ?? "", readings: [a.score, b.score], agreed: g.agreed, blank: g.blank };
}
