"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { SKIP_AUTH, DEV_TENANT_ID } from "@/lib/dev-auth";

async function resolveTenantId(): Promise<string | null> {
  if (SKIP_AUTH) return DEV_TENANT_ID;
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: row } = await createSupabaseAdminClient()
    .from("users").select("tenant_id").eq("id", user.id).single();
  return row?.tenant_id ?? null;
}

export async function deleteDossier(id: string): Promise<{ success: boolean; error?: string }> {
  const tenantId = await resolveTenantId();
  if (!tenantId) return { success: false, error: "Not authenticated" };

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("reference_dossiers")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) return { success: false, error: error.message };

  revalidatePath("/admin/dossiers");
  return { success: true };
}

export async function deleteDossiers(ids: string[]): Promise<{ success: boolean; error?: string }> {
  if (ids.length === 0) return { success: true };
  const tenantId = await resolveTenantId();
  if (!tenantId) return { success: false, error: "Not authenticated" };

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("reference_dossiers")
    .delete()
    .in("id", ids)
    .eq("tenant_id", tenantId);

  if (error) return { success: false, error: error.message };

  revalidatePath("/admin/dossiers");
  return { success: true };
}
