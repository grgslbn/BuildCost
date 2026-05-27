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
import type Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 120;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { dossierId, messages } = body as {
    dossierId: string;
    messages: ChatMessage[];
  };

  if (!dossierId || !messages?.length) {
    return new Response(JSON.stringify({ error: "Missing dossierId or messages" }), {
      status: 400,
    });
  }

  const admin = createSupabaseAdminClient();

  // ── Load all context in parallel ───────────────────────────────────
  const [dossierRes, gtRes, resultsRes, annotationsRes, prompts] =
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
      getPromptSettings(),
    ]);

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

## Ground truth (expert)
${gtSummary}

## Latest evaluation results
${resultsSummary}

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
  // First user message includes plan images
  const claudeMessages: Anthropic.MessageParam[] = messages.map(
    (msg, idx) => {
      if (idx === 0 && msg.role === "user" && planImageBlocks.length > 0) {
        return {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text: "Here are the floor plan images for this dossier:",
            },
            ...planImageBlocks,
            { type: "text" as const, text: `\n\nUser question: ${msg.content}` },
          ],
        };
      }
      return {
        role: msg.role as "user" | "assistant",
        content: msg.content,
      };
    }
  );

  // ── Stream response ────────────────────────────────────────────────
  const stream = await anthropic.messages.stream({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
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
