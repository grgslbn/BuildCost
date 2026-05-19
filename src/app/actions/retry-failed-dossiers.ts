"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { SKIP_AUTH, DEV_TENANT_ID } from "@/lib/dev-auth";

export async function retryFailedDossiers(): Promise<{ count: number }> {
  const admin = createSupabaseAdminClient();

  let tenantId: string | null = null;
  if (SKIP_AUTH) {
    tenantId = DEV_TENANT_ID;
  } else {
    const supabase = createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: userRow } = await admin
        .from("users")
        .select("tenant_id")
        .eq("id", user.id)
        .single();
      tenantId = userRow?.tenant_id ?? null;
    }
  }

  if (!tenantId) return { count: 0 };

  const { data } = await admin
    .from("reference_dossiers")
    .update({ status: "pending", error_message: null, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("status", "error")
    .select("id");

  revalidatePath("/admin/dossiers");
  return { count: (data ?? []).length };
}
