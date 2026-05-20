"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function activateModelVersion(modelVersionId: string): Promise<void> {
  const admin = createSupabaseAdminClient();

  const { error: deactivateError } = await admin
    .from("qqp_model_versions")
    .update({ is_active: false })
    .neq("id", modelVersionId);

  if (deactivateError) throw new Error(deactivateError.message);

  const { error: activateError } = await admin
    .from("qqp_model_versions")
    .update({ is_active: true })
    .eq("id", modelVersionId);

  if (activateError) throw new Error(activateError.message);

  revalidatePath("/admin/qqp");
}
