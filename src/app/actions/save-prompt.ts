"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { logApiCall } from "@/lib/ai/log-api-call";
import type { PromptKey } from "@/lib/ai/prompt-settings";

export async function savePrompt(key: PromptKey, value: string): Promise<void> {
  const admin = createSupabaseAdminClient();

  const { error } = await admin
    .from("system_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });

  if (error) throw new Error(error.message);

  logApiCall({
    call_type: "prompt_update",
    status: "success",
    duration_ms: 0,
  });
}

export async function resetPrompt(key: PromptKey): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin.from("system_settings").delete().eq("key", key);

  logApiCall({
    call_type: "prompt_update",
    status: "success",
    duration_ms: 0,
  });
}
