"use server";

import { randomUUID } from "crypto";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { SKIP_AUTH, DEV_TENANT_ID } from "@/lib/dev-auth";

export type UploadFileResult =
  | { status: "success"; dossierId: string; storagePath: string; fileName: string; fileType: string }
  | { status: "reused"; existingDossierId: string; storagePath: string; fileName: string; fileType: string }
  | { status: "error"; message: string };

export async function uploadFile(formData: FormData): Promise<UploadFileResult> {
  let tenantId: string;

  if (SKIP_AUTH) {
    tenantId = DEV_TENANT_ID;
  } else {
    const supabase = createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { status: "error", message: "Not authenticated" };

    const { data: userRow } = await createSupabaseAdminClient()
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userRow?.tenant_id) {
      return { status: "error", message: "Could not resolve tenant" };
    }
    tenantId = userRow.tenant_id;
  }

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) {
    return { status: "error", message: "No file provided" };
  }

  const admin = createSupabaseAdminClient();

  // Check if this filename already exists for this tenant
  const { data: existing } = await admin
    .from("reference_dossiers")
    .select("id, plan_storage_path, plan_file_name, plan_file_type")
    .eq("tenant_id", tenantId)
    .eq("plan_file_name", file.name)
    .maybeSingle();

  if (existing) {
    return {
      status: "reused",
      existingDossierId: existing.id,
      storagePath: existing.plan_storage_path,
      fileName: existing.plan_file_name,
      fileType: existing.plan_file_type ?? "pdf",
    };
  }

  const dossierId = randomUUID();
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "pdf";
  const storagePath = `${tenantId}/${dossierId}/${file.name}`;
  const fileType = ext === "pdf" ? "pdf" : "image";

  const arrayBuffer = await file.arrayBuffer();

  const { error } = await admin.storage
    .from("plans")
    .upload(storagePath, arrayBuffer, {
      contentType: file.type || (ext === "pdf" ? "application/pdf" : `image/${ext}`),
      upsert: false,
    });

  if (error) {
    return { status: "error", message: `Storage upload failed: ${error.message}` };
  }

  return { status: "success", dossierId, storagePath, fileName: file.name, fileType };
}
