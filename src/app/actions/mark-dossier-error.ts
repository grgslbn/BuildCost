"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function markDossierError(dossierId: string, message: string) {
  const admin = createSupabaseAdminClient();
  await admin
    .from("reference_dossiers")
    .update({ status: "error", error_message: message, updated_at: new Date().toISOString() })
    .eq("id", dossierId);
}
