"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export type SaveSettingResult =
  | { success: true; updatedAt: string }
  | { success: false; error: string };

export async function saveSetting(
  key: string,
  rawValue: string,
  valueType: "number" | "text" | "boolean"
): Promise<SaveSettingResult> {
  let jsonValue: unknown;

  try {
    if (valueType === "number") {
      const n = Number(rawValue);
      if (isNaN(n)) throw new Error("Invalid number");
      jsonValue = n;
    } else if (valueType === "boolean") {
      jsonValue = rawValue === "true";
    } else {
      jsonValue = rawValue;
    }
  } catch {
    return { success: false, error: "Invalid value format" };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("system_settings")
    .update({ value: jsonValue, updated_at: new Date().toISOString() })
    .eq("key", key)
    .select("updated_at")
    .single();

  if (error) return { success: false, error: error.message };

  revalidatePath("/admin/settings");
  return { success: true, updatedAt: data.updated_at };
}
