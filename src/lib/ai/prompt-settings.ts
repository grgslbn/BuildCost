import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  SQM_SYSTEM_PROMPT,
  SQM_USER_PROMPT,
  QQP_SYSTEM_PROMPT,
  QQP_USER_PROMPT_TEMPLATE,
} from "./prompts";
import { CLASSIFY_SYSTEM } from "@/lib/pdf/classify-pages";
import { METADATA_USER_TEMPLATE } from "@/lib/pdf/extract-metadata";

export const PROMPT_SEPARATOR = "\n\n===USER===\n\n";

export const PROMPT_KEYS = [
  "prompt_sqm_extraction",
  "prompt_qqp_extraction",
  "prompt_page_classification",
  "prompt_metadata_extraction",
] as const;

export type PromptKey = (typeof PROMPT_KEYS)[number];

export type LoadedPrompts = {
  sqmSystem: string;
  sqmUser: string;
  qqpSystem: string;
  qqpUserTemplate: string;
  pageClassification: string;
  metadataUser: string;
};

function splitPrompt(
  raw: string | undefined,
  defaultSystem: string,
  defaultUser: string
): [string, string] {
  if (!raw) return [defaultSystem, defaultUser];
  const idx = raw.indexOf(PROMPT_SEPARATOR);
  if (idx === -1) return [raw, defaultUser];
  return [raw.slice(0, idx), raw.slice(idx + PROMPT_SEPARATOR.length)];
}

export async function getPromptSettings(): Promise<LoadedPrompts> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("system_settings")
    .select("key, value")
    .in("key", [...PROMPT_KEYS]);

  const byKey = Object.fromEntries(
    (data ?? []).map((s) => [s.key, s.value as string])
  );

  const [sqmSystem, sqmUser] = splitPrompt(
    byKey["prompt_sqm_extraction"],
    SQM_SYSTEM_PROMPT,
    SQM_USER_PROMPT
  );
  const [qqpSystem, qqpUserTemplate] = splitPrompt(
    byKey["prompt_qqp_extraction"],
    QQP_SYSTEM_PROMPT,
    QQP_USER_PROMPT_TEMPLATE
  );
  const pageClassification =
    byKey["prompt_page_classification"] || CLASSIFY_SYSTEM;
  const metadataUser =
    byKey["prompt_metadata_extraction"] || METADATA_USER_TEMPLATE;

  return { sqmSystem, sqmUser, qqpSystem, qqpUserTemplate, pageClassification, metadataUser };
}
