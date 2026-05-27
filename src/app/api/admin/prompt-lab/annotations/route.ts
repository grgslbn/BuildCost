import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const dossierId = req.nextUrl.searchParams.get("dossierId");
  if (!dossierId) {
    return NextResponse.json({ error: "Missing dossierId" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("benchmark_annotations")
    .select("*")
    .eq("dossier_id", dossierId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      dossierId: string;
      category: string;
      body: string;
      runId?: string;
      createdBy?: string;
    };

    if (!body.dossierId || !body.body?.trim()) {
      return NextResponse.json({ error: "Missing dossierId or body" }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("benchmark_annotations")
      .insert({
        dossier_id: body.dossierId,
        category: body.category || "general",
        body: body.body.trim(),
        run_id: body.runId || null,
        created_by: body.createdBy || null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error("[annotations POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
