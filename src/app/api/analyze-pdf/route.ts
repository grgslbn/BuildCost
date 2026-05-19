import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { SKIP_AUTH } from "@/lib/dev-auth";
import { splitPdfPages } from "@/lib/pdf/split-pages";
import { classifyPages } from "@/lib/pdf/classify-pages";
import { extractMetadata } from "@/lib/pdf/extract-metadata";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    if (!SKIP_AUTH) {
      const supabase = createSupabaseServerClient();
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (error || !user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const { storagePath } = (await req.json()) as { storagePath?: string };
    if (!storagePath) {
      return NextResponse.json({ error: "Missing storagePath" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();

    // Load extraction model from settings
    const { data: setting } = await admin
      .from("system_settings")
      .select("value")
      .eq("key", "extraction_model")
      .single();
    const model =
      (setting?.value as string) ?? "claude-sonnet-4-20250514";

    // Download PDF from Storage
    const { data: blob, error: storageErr } = await admin.storage
      .from("plans")
      .download(storagePath);

    if (storageErr || !blob) {
      return NextResponse.json(
        { error: `Storage download failed: ${storageErr?.message}` },
        { status: 500 }
      );
    }

    const buffer = Buffer.from(await blob.arrayBuffer());

    // Step 1: Split into single-page PDFs
    const { pages, totalPageCount } = await splitPdfPages(buffer, 40);

    // Step 2: Classify pages (batches of 4)
    const classifications = await classifyPages(pages, model);

    // Step 3: Extract metadata from expert_report / pricing_table pages
    const extractedMetadata = await extractMetadata(pages, classifications, model);

    const floorPlanPages = classifications
      .filter((c) => c.type === "floor_plan")
      .map((c) => c.pageNumber);

    return NextResponse.json({
      totalPageCount,
      processedPageCount: pages.length,
      classifications,
      floorPlanPages,
      extractedMetadata,
    });
  } catch (err) {
    console.error("[analyze-pdf]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
