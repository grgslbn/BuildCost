"use server";

import { randomUUID } from "crypto";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { SKIP_AUTH, DEV_TENANT_ID } from "@/lib/dev-auth";

export type UploadPlanResult =
  | { status: "success"; storagePath: string; fileName: string; fileType: string }
  | { status: "error"; message: string };

export async function uploadPlan(formData: FormData): Promise<UploadPlanResult> {
  let tenantId: string;

  if (SKIP_AUTH) {
    tenantId = DEV_TENANT_ID;
  } else {
    const supabase = createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { status: "error", message: "Not authenticated" };

    const { data: userRow } = await createSupabaseAdminClient()
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userRow?.tenant_id) return { status: "error", message: "Could not resolve tenant" };
    tenantId = userRow.tenant_id;
  }

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { status: "error", message: "No file provided" };

  const admin = createSupabaseAdminClient();
  const id = randomUUID();
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "pdf";
  const storagePath = `${tenantId}/estimates/${id}/${file.name}`;
  const fileType = ext === "pdf" ? "pdf" : "image";

  const arrayBuffer = await file.arrayBuffer();
  const { error } = await admin.storage.from("plans").upload(storagePath, arrayBuffer, {
    contentType: file.type || (ext === "pdf" ? "application/pdf" : `image/${ext}`),
    upsert: false,
  });

  if (error) return { status: "error", message: `Upload failed: ${error.message}` };

  return { status: "success", storagePath, fileName: file.name, fileType };
}
