import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const dossierId = formData.get("dossierId") as string;
    const fileType = formData.get("fileType") as "plan" | "calculation";
    const file = formData.get("file") as File | null;

    if (!dossierId || !fileType || !file || file.size === 0) {
      return NextResponse.json(
        { error: "Missing dossierId, fileType, or file" },
        { status: 400 },
      );
    }

    if (fileType !== "plan" && fileType !== "calculation") {
      return NextResponse.json(
        { error: "fileType must be 'plan' or 'calculation'" },
        { status: 400 },
      );
    }

    const admin = createSupabaseAdminClient();

    const { data: dossier, error: dossierErr } = await admin
      .from("reference_dossiers")
      .select("id, tenant_id")
      .eq("id", dossierId)
      .single();

    if (dossierErr || !dossier) {
      return NextResponse.json({ error: "Dossier not found" }, { status: 404 });
    }

    const storagePath = `${dossier.tenant_id}/${dossierId}/${fileType}-${file.name}`;
    const arrayBuffer = await file.arrayBuffer();

    const { error: storageError } = await admin.storage
      .from("plans")
      .upload(storagePath, arrayBuffer, {
        contentType: file.type || "application/pdf",
        upsert: true,
      });

    if (storageError) {
      return NextResponse.json(
        { error: `Upload failed: ${storageError.message}` },
        { status: 500 },
      );
    }

    const updateCol =
      fileType === "plan"
        ? { plan_storage_path: storagePath, plan_file_name: file.name }
        : { calculation_storage_path: storagePath, calculation_file_name: file.name };

    const { error: dbError } = await admin
      .from("reference_dossiers")
      .update(updateCol)
      .eq("id", dossierId);

    if (dbError) {
      return NextResponse.json(
        { error: `DB update failed: ${dbError.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, storagePath });
  } catch (err) {
    console.error("[admin/benchmark/upload]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
