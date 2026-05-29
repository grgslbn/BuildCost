/**
 * POST /api/admin/prompt-lab/chat
 *
 * Streaming chat endpoint for dossier-level prompt iteration.
 * Loads full context (plan images, GT, results, prompts, annotations)
 * and streams Claude's response.
 */

import { NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { anthropic } from "@/lib/ai/client";
import { getPromptSettings } from "@/lib/ai/prompt-settings";
import { getFloorPlanPages } from "@/lib/pdf/classify-pages-local";
import { renderPdfPagesToImages } from "@/lib/pdf/render-plans";
import { interpolatePrice, type PricingConfig } from "@/lib/cost/calculate-cost";
import type Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 120;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

// Structured-analysis instruction injected when the client requests mode:"analyze".
const ANALYZE_INSTRUCTION = `Voer nu een volledige analyse uit van dit dossier. Bekijk de plan-afbeeldingen, de SQM per-verdiep extractie, de QQP-scores, de afgeleide eenheidsprijzen en de CED-vergelijking. Structureer je antwoord in exact deze vier secties (gebruik Markdown-koppen):

## 1. Wat loopt goed
Welke stappen kloppen (SQM / QQP / F / eenheidsprijs / totaal)? Wees concreet met cijfers.

## 2. Wat loopt fout
Per stap (SQM, QQP, F, eenheidsprijs, totaal): waar wijkt de LLM af van CED en waaróm (vision-limiet, schaalfout, gemiste kamer, foute QQP-score, ...)? Verwijs naar specifieke verdiepen/kamers.

## 3. Aanbevelingen voor de prompts
Concrete, copy-pastebare aanpassingen voor de SQM-extractieprompt en de QQP-extractieprompt om deze fouten te vermijden.

## 4. Vragen om SQM/QQP te verfijnen
Stel 2–4 gerichte vragen aan de gebruiker waarvan het antwoord helpt om de SQM- of QQP-extractie te verbeteren.`;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { dossierId, messages, mode } = body as {
    dossierId: string;
    messages: ChatMessage[];
    mode?: "analyze" | "chat";
  };

  if (!dossierId || !messages?.length) {
    return new Response(JSON.stringify({ error: "Missing dossierId or messages" }), {
      status: 400,
    });
  }

  const admin = createSupabaseAdminClient();

  // ── Load all context in parallel ───────────────────────────────────
  const [dossierRes, gtRes, resultsRes, annotationsRes, settingsRes, prompts] =
    await Promise.all([
      admin
        .from("reference_dossiers")
        .select(
          "id, plan_file_name, calculation_file_name, plan_storage_path, address, postcode, building_type"
        )
        .eq("id", dossierId)
        .single(),
      admin
        .from("benchmark_ground_truth")
        .select("*")
        .eq("dossier_id", dossierId)
        .maybeSingle(),
      admin
        .from("evaluation_results")
        .select("*, evaluation_runs!inner(id, name, started_at)")
        .eq("dossier_id", dossierId)
        .order("created_at", { ascending: false })
        .limit(5),
      admin
        .from("benchmark_annotations")
        .select("*")
        .eq("dossier_id", dossierId)
        .order("created_at", { ascending: false }),
      admin
        .from("system_settings")
        .select("key, value")
        .in("key", [
          "cat1_price_min", "cat1_price_max",
          "cat2_price_min", "cat2_price_max",
          "cat3_price_min", "cat3_price_max",
        ]),
      getPromptSettings(),
    ]);

  const settings = Object.fromEntries((settingsRes.data ?? []).map((s) => [s.key, s.value]));
  const pricing: PricingConfig = {
    cat1_min: (settings.cat1_price_min as number) ?? 1100,
    cat1_max: (settings.cat1_price_max as number) ?? 1900,
    cat2_min: (settings.cat2_price_min as number) ?? 550,
    cat2_max: (settings.cat2_price_max as number) ?? 950,
    cat3_min: (settings.cat3_price_min as number) ?? 330,
    cat3_max: (settings.cat3_price_max as number) ?? 570,
  };

  const dossier = dossierRes.data;
  if (!dossier?.plan_storage_path) {
    return new Response(
      JSON.stringify({ error: "Dossier not found or no plan uploaded" }),
      { status: 404 }
    );
  }

  // ── Download & render plan images ──────────────────────────────────
  const { data: fileBlob } = await admin.storage
    .from("plans")
    .download(dossier.plan_storage_path);

  let planImageBlocks: Anthropic.ContentBlockParam[] = [];

  if (fileBlob) {
    const arrayBuffer = await fileBlob.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    try {
      const { floorPlanPages, allClassifications } =
        await getFloorPlanPages(pdfBuffer, 40);

      const planClassifications = allClassifications
        .filter((p) => floorPlanPages.includes(p.pageNumber))
        .slice(0, 10);

      const planImages = await renderPdfPagesToImages(
        pdfBuffer,
        planClassifications,
        { maxWidth: 3000, dpi: 200 } // slightly lower res for chat to save tokens
      );

      planImageBlocks = planImages.flatMap(
        (img): Anthropic.ContentBlockParam[] => [
          {
            type: "text" as const,
            text: `\n--- Floor plan image: ${img.name} (${img.floorLabels.join(", ") || "unlabeled"}) ---`,
          },
          {
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: "image/png" as const,
              data: img.png.toString("base64"),
            },
          },
        ]
      );
    } catch (renderErr) {
      console.warn(
        "[prompt-lab/chat] mupdf render failed:",
        (renderErr as Error).message?.slice(0, 100)
      );
      // Fall back: no images, just text context
    }
  }

  // ── Build context for system prompt ────────────────────────────────
  const gt = gtRes.data;
  const results = resultsRes.data ?? [];
  const annotations = annotationsRes.data ?? [];

  const gtSummary = gt
    ? [
        `Expert total price: €${gt.expert_total_price?.toLocaleString("nl-BE") ?? "unknown"}`,
        `Expert finishing level: ${gt.expert_finishing_level ?? "unknown"}`,
        `Expert Cat1 SQM: ${gt.expert_cat1_sqm?.toFixed(1) ?? "?"} m²`,
        `Expert Cat2 SQM: ${gt.expert_cat2_sqm?.toFixed(1) ?? "?"} m²`,
        `Expert Cat3 SQM: ${gt.expert_cat3_sqm?.toFixed(1) ?? "?"} m²`,
        `Extraction confidence: ${gt.extraction_confidence?.toFixed(2) ?? "?"}`,
      ].join("\n")
    : "No ground truth available yet.";

  const resultsSummary =
    results.length > 0
      ? results
          .map((r: Record<string, unknown>) => {
            const run = r.evaluation_runs as {
              name: string;
              started_at: string;
            };
            return [
              `Run "${run.name}" (${new Date(run.started_at).toLocaleDateString("nl-BE")}):`,
              `  Predicted cost: €${(r.predicted_total_cost as number)?.toLocaleString("nl-BE") ?? "?"}`,
              `  Cost error: ${(r.cost_error_pct as number)?.toFixed(1) ?? "?"}%`,
              `  Cat1 error: ${(r.cat1_error_pct as number)?.toFixed(1) ?? "?"}%`,
              `  Cat2 error: ${(r.cat2_error_pct as number)?.toFixed(1) ?? "?"}%`,
              `  Cat3 error: ${(r.cat3_error_pct as number)?.toFixed(1) ?? "?"}%`,
              `  Predicted F: ${(r.predicted_f as number)?.toFixed(2) ?? "?"}`,
              `  Expert F: ${(r.expert_f as number)?.toFixed(2) ?? "?"}`,
              r.error_message
                ? `  ERROR: ${r.error_message}`
                : "",
            ]
              .filter(Boolean)
              .join("\n");
          })
          .join("\n\n")
      : "No evaluation results yet — run a test first.";

  const annotationsSummary =
    annotations.length > 0
      ? annotations
          .map(
            (a: Record<string, unknown>) =>
              `[${a.category}] ${a.body} (${new Date(a.created_at as string).toLocaleDateString("nl-BE")})`
          )
          .join("\n")
      : "No annotations.";

  // ── Detailed per-step data from the latest successful result ───────
  const latest = (results as Record<string, unknown>[]).find(
    (r) => !r.error_message && r.predicted_total_cost != null,
  );

  // SQM per-floor breakdown (the actual extraction, not just totals)
  let sqmDetail = "No SQM extraction available.";
  const sqmEx = latest?.sqm_extraction as
    | {
        project?: { description?: string; scale?: string; scale_confidence?: number };
        buildings?: Array<{
          name?: string; id?: string; type?: string;
          floors?: Array<{ label: string; cat1_sqm: number; cat2_sqm: number; cat3_sqm: number; contents?: string; measurement?: string }>;
        }>;
        extraction_warnings?: string[];
      }
    | undefined;
  if (sqmEx?.buildings?.length) {
    const lines: string[] = [];
    if (sqmEx.project?.description) lines.push(`Project: ${sqmEx.project.description}`);
    if (sqmEx.project?.scale) lines.push(`Scale: ${sqmEx.project.scale} (confidence ${sqmEx.project.scale_confidence ?? "?"})`);
    for (const b of sqmEx.buildings) {
      lines.push(`\nBuilding "${b.name ?? b.id}" (${b.type ?? "?"}):`);
      for (const f of b.floors ?? []) {
        lines.push(`  - ${f.label}: Cat1 ${f.cat1_sqm}m² / Cat2 ${f.cat2_sqm}m² / Cat3 ${f.cat3_sqm}m²${f.contents ? ` — ${f.contents}` : ""}${f.measurement ? ` [${f.measurement}]` : ""}`);
      }
    }
    if (sqmEx.extraction_warnings?.length) {
      lines.push(`\nWarnings:\n${sqmEx.extraction_warnings.map((w) => `  • ${w}`).join("\n")}`);
    }
    sqmDetail = lines.join("\n");
  }

  // QQP scores with reasoning
  let qqpDetail = "No QQP scores available.";
  const qqpVals = latest?.extracted_qqps as
    | Record<string, { score: number; confidence?: number; reasoning?: string }>
    | undefined;
  if (qqpVals && Object.keys(qqpVals).length > 0) {
    qqpDetail = Object.entries(qqpVals)
      .map(([name, v]) => `  ${name}: ${v.score >= 0 ? "+" : ""}${v.score.toFixed(2)} (conf ${v.confidence?.toFixed(2) ?? "?"})${v.reasoning ? ` — ${v.reasoning}` : ""}`)
      .join("\n");
  }

  // Derived unit prices per category (LLM vs expert, both from F via the pricing curve)
  let unitPriceDetail = "No F available to derive unit prices.";
  const predF = latest?.predicted_f as number | null;
  const expF = latest?.expert_f as number | null;
  if (predF != null) {
    const llmP = {
      cat1: Math.round(interpolatePrice(predF, pricing.cat1_min, pricing.cat1_max)),
      cat2: Math.round(interpolatePrice(predF, pricing.cat2_min, pricing.cat2_max)),
      cat3: Math.round(interpolatePrice(predF, pricing.cat3_min, pricing.cat3_max)),
    };
    const expP = expF != null ? {
      cat1: Math.round(interpolatePrice(expF, pricing.cat1_min, pricing.cat1_max)),
      cat2: Math.round(interpolatePrice(expF, pricing.cat2_min, pricing.cat2_max)),
      cat3: Math.round(interpolatePrice(expF, pricing.cat3_min, pricing.cat3_max)),
    } : null;
    unitPriceDetail = [
      `Predicted F: ${predF.toFixed(2)} → LLM €/m²: CAT1 ${llmP.cat1}, CAT2 ${llmP.cat2}, CAT3 ${llmP.cat3}`,
      expP ? `Expert F: ${expF!.toFixed(2)} → afgeleide expert €/m²: CAT1 ${expP.cat1}, CAT2 ${expP.cat2}, CAT3 ${expP.cat3}` : "Expert F: unknown",
      gt?.expert_total_price && gt?.expert_cat1_sqm ? `Reality-check expert €/m² woonopp = ${Math.round(gt.expert_total_price / gt.expert_cat1_sqm)}` : "",
    ].filter(Boolean).join("\n");
  }

  const systemPrompt = `You are a prompt engineering assistant for PlanBase, a Belgian building cost estimation tool.
You are helping the user iterate on extraction prompts by analyzing a specific dossier.

## Your role
- Analyze the floor plan images and explain what you see
- Compare extraction results with expert ground truth
- Identify why errors occur (vision limits, prompt issues, scale errors, missing rooms, etc.)
- Suggest specific prompt improvements for SQM extraction and QQP extraction
- Be precise and concrete — reference specific rooms, floors, and measurements

## Dossier context
File: ${dossier.plan_file_name ?? "unknown"}
Address: ${dossier.address ?? "unknown"}, ${dossier.postcode ?? "unknown"}
Building type: ${dossier.building_type ?? "unknown"}

## Ground truth (expert / CED)
${gtSummary}

## Latest evaluation results (aggregate errors per run)
${resultsSummary}

## SQM-lens — per-verdiep extractie (laatste run)
${sqmDetail}

## QQP-lens — scores (laatste run, -1 = onder standaard, 0 = gemiddeld, +1 = luxe)
${qqpDetail}

## Eenheidsprijzen per categorie (afgeleid uit F)
${unitPriceDetail}

## Annotations
${annotationsSummary}

## Current SQM extraction prompt (system)
\`\`\`
${prompts.sqmSystem.slice(0, 3000)}${prompts.sqmSystem.length > 3000 ? "\n... [truncated]" : ""}
\`\`\`

## Current SQM extraction prompt (user template)
\`\`\`
${prompts.sqmUser.slice(0, 2000)}${prompts.sqmUser.length > 2000 ? "\n... [truncated]" : ""}
\`\`\`

## Current QQP extraction prompt (system)
\`\`\`
${prompts.qqpSystem.slice(0, 2000)}${prompts.qqpSystem.length > 2000 ? "\n... [truncated]" : ""}
\`\`\`

Respond in Dutch or English depending on what the user writes. Be concise but thorough.`;

  // ── Build messages for Claude ──────────────────────────────────────
  // In analyze mode, the first user turn is replaced by the structured-analysis
  // instruction (the client just sends a trigger message).
  const firstUserText =
    mode === "analyze" ? ANALYZE_INSTRUCTION : messages[0]?.content ?? "";

  // First user message includes plan images
  const claudeMessages: Anthropic.MessageParam[] = messages.map(
    (msg, idx) => {
      const text = idx === 0 ? firstUserText : msg.content;
      if (idx === 0 && msg.role === "user" && planImageBlocks.length > 0) {
        return {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text: "Here are the floor plan images for this dossier:",
            },
            ...planImageBlocks,
            { type: "text" as const, text: `\n\n${mode === "analyze" ? text : `User question: ${text}`}` },
          ],
        };
      }
      return {
        role: msg.role as "user" | "assistant",
        content: text,
      };
    }
  );

  // ── Stream response ────────────────────────────────────────────────
  const stream = await anthropic.messages.stream({
    model: "claude-sonnet-4-20250514",
    max_tokens: mode === "analyze" ? 6000 : 4096,
    system: systemPrompt,
    messages: claudeMessages,
  });

  // Convert Anthropic SDK stream to Web ReadableStream for Next.js
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`)
            );
          }
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: (err as Error).message })}\n\n`
          )
        );
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
