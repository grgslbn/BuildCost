import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { SKIP_AUTH, DEV_TENANT_ID } from "@/lib/dev-auth";
import { getDriveClient } from "@/lib/gdrive/client";
import { randomUUID } from "crypto";

export const maxDuration = 120;

export type ImportResult =
  | { status: "imported"; id: string }
  | { status: "skipped"; reason: string }
  | { status: "error"; message: string };

export async function POST(req: NextRequest): Promise<NextResponse<ImportResult>> {
  const admin = createSupabaseAdminClient();

  // Resolve tenant
  let tenantId: string;
  if (SKIP_AUTH) {
    tenantId = DEV_TENANT_ID;
  } else {
    const supabase = createSupabaseServerClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ status: "error", message: "Unauthorized" }, { status: 401 });
    }
    const { data: userRow } = await admin
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();
    if (!userRow?.tenant_id) {
      return NextResponse.json({ status: "error", message: "No tenant" }, { status: 403 });
    }
    tenantId = userRow.tenant_id;
  }

  const { fileId, fileName } = (await req.json()) as { fileId?: string; fileName?: string };
  if (!fileId || !fileName) {
    return NextResponse.json({ status: "error", message: "Missing fileId or fileName" }, { status: 400 });
  }

  // Duplicate check — same filename within the tenant
  const { data: existing } = await admin
    .from("reference_dossiers")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("plan_file_name", fileName)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ status: "skipped", reason: "duplicate" });
  }

  try {
    // Download from Google Drive
    const drive = getDriveClient();
    const res = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" }
    );
    const buffer = Buffer.from(res.data as ArrayBuffer);

    // Upload to Supabase Storage
    const id = randomUUID();
    const storagePath = `${tenantId}/${id}/${fileName}`;
    const { error: uploadError } = await admin.storage
      .from("plans")
      .upload(storagePath, buffer, { contentType: "application/pdf", upsert: false });

    if (uploadError) {
      return NextResponse.json({ status: "error", message: `Storage upload failed: ${uploadError.message}` });
    }

    // Insert reference_dossiers row
    const { error: insertError } = await admin.from("reference_dossiers").insert({
      id,
      tenant_id: tenantId,
      plan_storage_path: storagePath,
      plan_file_name: fileName,
      plan_file_type: "pdf",
      status: "pending",
    });

    if (insertError) {
      await admin.storage.from("plans").remove([storagePath]);
      return NextResponse.json({ status: "error", message: `DB insert failed: ${insertError.message}` });
    }

    return NextResponse.json({ status: "imported", id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error";
    console.error("[gdrive-import]", err);
    return NextResponse.json({ status: "error", message: msg });
  }
}
