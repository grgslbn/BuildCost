import Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/ai/client";
import { parseClaudeJson } from "@/lib/ai/prompts";
import type { SplitPage } from "./split-pages";
import type { PageClassification } from "./classify-pages";

export type ExtractedDossierMetadata = {
  address: string | null;
  postcode: string | null;
  municipality: string | null;
  building_type: string | null;
  apartment_count: number | null;
  known_total_price: number | null;
  known_total_sqm: number | null;
  known_price_per_sqm: number | null;
  expert_finishing_level: string | null;
  expert_notes: string | null;
};

export const METADATA_USER_TEMPLATE = `These pages are from a Belgian building insurance/reconstruction dossier. Extract metadata.

Return ONLY valid JSON:
{
  "address": "full street address or null",
  "postcode": "4-digit Belgian postcode or null",
  "municipality": "city name or null",
  "building_type": "house|apartment|apartment_building|villa|duplex|studio|commercial or null",
  "apartment_count": null,
  "known_total_price": null,
  "known_total_sqm": null,
  "known_price_per_sqm": null,
  "expert_finishing_level": "basic|standard|comfort|luxury|premium or null",
  "expert_notes": "2-3 sentence summary of expert description or null"
}

Rules:
- Extract the RECONSTRUCTION cost, not the real estate value
- postcode must be exactly 4 digits
- Use building_type "apartment_building" when multiple units are listed (e.g. "12 appartementen", "résidence de 8 appartements")
- apartment_count is the total number of units (integer), only for apartment_building
- Return null for anything not present or unclear
No markdown, no explanation.`;

const EMPTY: ExtractedDossierMetadata = {
  address: null,
  postcode: null,
  municipality: null,
  building_type: null,
  apartment_count: null,
  known_total_price: null,
  known_total_sqm: null,
  known_price_per_sqm: null,
  expert_finishing_level: null,
  expert_notes: null,
};

export type ExtractMetadataResult = {
  metadata: ExtractedDossierMetadata;
  tokensInput: number;
  tokensOutput: number;
};

export async function extractMetadata(
  pages: SplitPage[],
  classifications: PageClassification[],
  model: string,
  userTemplate?: string
): Promise<ExtractMetadataResult> {
  const relevantNums = new Set(
    classifications
      .filter((c) => c.type === "expert_report" || c.type === "pricing_table")
      .map((c) => c.pageNumber)
  );

  // Prefer expert_report/pricing_table pages; fall back to first pages of the
  // document (cover, other) which almost always carry address + postcode in
  // Belgian insurance VerzamelPDFs.
  const relevant = relevantNums.size > 0
    ? pages.filter((p) => relevantNums.has(p.pageNumber)).slice(0, 6)
    : pages.slice(0, 4);

  const content: Anthropic.MessageParam["content"] = relevant.map((p) => ({
    type: "document",
    source: {
      type: "base64",
      media_type: "application/pdf",
      data: p.base64,
    },
  } as Anthropic.DocumentBlockParam));

  content.push({
    type: "text",
    text: userTemplate ?? METADATA_USER_TEMPLATE,
  });

  const response = await anthropic.messages.create({
    model,
    max_tokens: 2048,
    messages: [{ role: "user", content }],
  });

  const raw =
    response.content[0].type === "text" ? response.content[0].text : "{}";

  try {
    return {
      metadata: parseClaudeJson(raw) as ExtractedDossierMetadata,
      tokensInput: response.usage.input_tokens,
      tokensOutput: response.usage.output_tokens,
    };
  } catch {
    return {
      metadata: EMPTY,
      tokensInput: response.usage.input_tokens,
      tokensOutput: response.usage.output_tokens,
    };
  }
}
