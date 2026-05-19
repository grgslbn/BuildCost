import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { SKIP_AUTH, DEV_TENANT_ID } from "@/lib/dev-auth";

// Tiny request (just a filename string) — no file bytes through Vercel.
// Returns a signed upload URL so the browser can PUT directly to Supabase Storage.
export async function POST(req: NextRequest) {
  const admin = createSupabaseAdminClient();

  let tenantId: string;
  if (SKIP_AUTH) {
    tenantId = DEV_TENANT_ID;
  } else {
    const supabase = createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data: userRow } = await admin.from("users").select("tenant_id").eq("id", user.id).single();
    if (!userRow?.tenant_id) return NextResponse.json({ error: "No tenant" }, { status: 403 });
    tenantId = userRow.tenant_id;
  }

  const { filename, checkDuplicate } = (await req.json()) as {
    filename: string;
    checkDuplicate?: boolean;
  };
  if (!filename) return NextResponse.json({ error: "Missing filename" }, { status: 400 });

  // Optional duplicate check (for dossier uploads)
  if (checkDuplicate) {
    const { data: existing } = await admin
      .from("reference_dossiers")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("plan_file_name", filename)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ status: "duplicate", existingId: existing.id });
    }
  }

  const id = randomUUID();
  const path = `${tenantId}/${id}/${filename}`;

  const { data, error } = await admin.storage.from("plans").createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Failed to create signed URL" }, { status: 500 });
  }

  return NextResponse.json({
    status: "ok",
    id,
    path,
    token: data.token,
    signedUrl: data.signedUrl,
  });
}
