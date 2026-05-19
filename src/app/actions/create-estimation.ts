"use server";

import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { SKIP_AUTH, DEV_TENANT_ID } from "@/lib/dev-auth";

export type CreateEstimationResult =
  | { status: "success"; estimationId: string }
  | { status: "error"; message: string };

export async function createEstimation(input: {
  storagePath: string;
  fileName: string;
  fileType: string;
  postcode: string;
}): Promise<CreateEstimationResult> {
  let tenantId: string;
  let createdBy: string | null = null;

  if (SKIP_AUTH) {
    tenantId = DEV_TENANT_ID;
  } else {
    const supabase = createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { status: "error", message: "Not authenticated" };
    createdBy = user.id;

    const { data: userRow } = await createSupabaseAdminClient()
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();
    if (!userRow?.tenant_id) return { status: "error", message: "No tenant" };
    tenantId = userRow.tenant_id;
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("estimations")
    .insert({
      tenant_id: tenantId,
      created_by: createdBy,
      plan_storage_path: input.storagePath,
      plan_file_name: input.fileName,
      postcode: input.postcode,
      postcode_provided_by: "user",
      status: "uploading",
    })
    .select("id")
    .single();

  if (error || !data) {
    return { status: "error", message: error?.message ?? "Failed to create estimation" };
  }

  return { status: "success", estimationId: data.id };
}
