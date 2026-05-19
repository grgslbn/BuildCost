import Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@/lib/ai/client";
import { parseClaudeJson } from "@/lib/ai/prompts";
import type { SplitPage } from "./split-pages";

export type PageType =
  | "floor_plan"
  | "expert_report"
  | "photo"
  | "pricing_table"
  | "cover"
  | "other";

export type PageClassification = {
  pageNumber: number;
  type: PageType;
  confidence: number;
  description: string;
};

const CLASSIFY_SYSTEM = `You are analyzing pages from a Belgian building insurance dossier (VerzamelPDF). Classify each page into one of:
- floor_plan: Architectural floor plan showing room layout, walls, dimensions
- expert_report: Text-heavy page with expert building assessment or observations
- photo: Photograph of the building exterior, rooms, or damage
- pricing_table: Page showing cost calculations, price tables, totals
- cover: Title page, index, or table of contents
- other: Anything else

floor_plan identification is critical — look for room labels, dimension lines, wall thickness, north arrow, or scale indicators.`;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function classifyPages(
  pages: SplitPage[],
  model: string
): Promise<PageClassification[]> {
  const batches = chunk(pages, 4);
  const results: PageClassification[] = [];

  for (const batch of batches) {
    const content: Anthropic.MessageParam["content"] = [];

    for (const page of batch) {
      content.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: page.base64,
        },
      } as Anthropic.DocumentBlockParam);
      content.push({
        type: "text",
        text: `Above is page ${page.pageNumber}.`,
      });
    }

    content.push({
      type: "text",
      text: `Classify each of the ${batch.length} pages shown above.
Return ONLY a JSON array with exactly ${batch.length} objects in page order:
[{"pageNumber": N, "type": "floor_plan|expert_report|photo|pricing_table|cover|other", "confidence": 0.0, "description": "brief description"}]
No markdown, no explanation.`,
    });

    const response = await anthropic.messages.create({
      model,
      max_tokens: 512,
      system: CLASSIFY_SYSTEM,
      messages: [{ role: "user", content }],
    });

    const raw =
      response.content[0].type === "text" ? response.content[0].text : "[]";

    try {
      const parsed = parseClaudeJson(raw) as Array<{
        pageNumber?: number;
        type: PageType;
        confidence: number;
        description: string;
      }>;
      for (let i = 0; i < batch.length; i++) {
        const r = parsed[i] ?? {
          type: "other" as PageType,
          confidence: 0.5,
          description: "",
        };
        results.push({
          pageNumber: batch[i].pageNumber,
          type: r.type ?? "other",
          confidence: r.confidence ?? 0.5,
          description: r.description ?? "",
        });
      }
    } catch {
      for (const page of batch) {
        results.push({
          pageNumber: page.pageNumber,
          type: "other",
          confidence: 0.5,
          description: "Classification failed",
        });
      }
    }
  }

  return results;
}
