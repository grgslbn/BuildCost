"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { logApiCall } from "@/lib/ai/log-api-call";
import type { PromptKey } from "@/lib/ai/prompt-settings";

export async function savePrompt(
  key: PromptKey,
  value: string
): Promise<{ error?: string }> {
  try {
    const admin = createSupabaseAdminClient();

    // JSON.stringify wraps the prompt text as a JSON string literal before it
    // lands in the JSONB column. This ensures all special characters (backticks,
    // pipes, newlines, markdown fences) are properly escaped regardless of size.
    const { error } = await admin
      .from("system_settings")
      .upsert(
        { key, value: JSON.stringify(value), updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );

    if (error) return { error: `Failed to save prompt: ${error.message}` };

    logApiCall({ call_type: "prompt_update", status: "success", duration_ms: 0 });
    return {};
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error saving prompt";
    return { error: message };
  }
}

export async function resetPrompt(key: PromptKey): Promise<{ error?: string }> {
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("system_settings")
      .delete()
      .eq("key", key);

    if (error) return { error: `Failed to reset prompt: ${error.message}` };

    logApiCall({ call_type: "prompt_update", status: "success", duration_ms: 0 });
    return {};
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error resetting prompt";
    return { error: message };
  }
}
