import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  SQM_SYSTEM_PROMPT,
  SQM_USER_PROMPT,
  QQP_SYSTEM_PROMPT,
  QQP_USER_PROMPT_TEMPLATE,
} from "./prompts";
import { CLASSIFY_SYSTEM } from "@/lib/pdf/classify-pages";
import { METADATA_USER_TEMPLATE } from "@/lib/pdf/extract-metadata";

// Re-export for backward compatibility
export const PROMPT_SEPARATOR = "\n\n===USER===\n\n";
export const PROMPT_KEYS = [
  "prompt_sqm_extraction",
  "prompt_qqp_extraction",
  "prompt_page_classification",
  "prompt_metadata_extraction",
] as const;
export type PromptKey = (typeof PROMPT_KEYS)[number];

export type PromptVersion = {
  id: string;
  prompt_type: string;
  version_number: number;
  system_prompt: string;
  user_template: string;
  is_active: boolean;
  notes: string | null;
};

export type LoadedPrompts = {
  sqmSystem: string;
  sqmUser: string;
  qqpSystem: string;
  qqpUserTemplate: string;
  pageClassification: string;
  metadataUser: string;
  /** Active prompt_versions row IDs (null if using hardcoded fallback) */
  sqmPromptVersionId: string | null;
  qqpPromptVersionId: string | null;
  usingDefaults: {
    sqm: boolean;
    qqp: boolean;
    pageClassification: boolean;
    metadataUser: boolean;
  };
};

// Strings that indicate a DB row holds a placeholder rather than a real prompt.
const PLACEHOLDER_PATTERNS = [
  "YOUR_PROMPT_TEXT_HERE",
  "[The current",
  "goes here]",
  "PLACEHOLDER",
];
const MIN_REAL_PROMPT_LENGTH = 80;

function isPlaceholder(value: string): boolean {
  if (!value || value.length < MIN_REAL_PROMPT_LENGTH) return true;
  return PLACEHOLDER_PATTERNS.some((p) => value.includes(p));
}

// Unwraps a value that may have been stored via JSON.stringify()
function unwrapValue(raw: unknown): string {
  if (typeof raw !== "string") return "";
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
  } catch {
    // plain string stored directly
  }
  return raw;
}

/**
 * Load prompts from prompt_versions table (SQM/QQP) and system_settings (others).
 *
 * Priority for SQM and QQP:
 * 1. Active row in prompt_versions table
 * 2. Hardcoded fallback from prompts.ts
 *
 * Page classification and metadata prompts still use system_settings.
 */
export async function getPromptSettings(): Promise<LoadedPrompts> {
  const admin = createSupabaseAdminClient();

  // Load active prompt versions for SQM and QQP
  const { data: activeVersions } = await admin
    .from("prompt_versions")
    .select("*")
    .eq("is_active", true);

  const versionsByType = new Map(
    (activeVersions ?? []).map((v) => [v.prompt_type, v])
  );

  // SQM prompt: prefer prompt_versions, fallback to hardcoded v11b
  const sqmVersion = versionsByType.get("sqm_extraction") as
    | PromptVersion
    | undefined;
  let sqmSystem: string;
  let sqmUser: string;
  let sqmIsDefault: boolean;
  let sqmPromptVersionId: string | null = null;

  if (sqmVersion && !isPlaceholder(sqmVersion.system_prompt)) {
    sqmSystem = sqmVersion.system_prompt;
    sqmUser = sqmVersion.user_template;
    sqmIsDefault = false;
    sqmPromptVersionId = sqmVersion.id;
  } else {
    // v11b: always use hardcoded SQM prompt as fallback
    sqmSystem = SQM_SYSTEM_PROMPT;
    sqmUser = SQM_USER_PROMPT;
    sqmIsDefault = true;
  }

  // QQP prompt: prefer prompt_versions, fallback to hardcoded
  const qqpVersion = versionsByType.get("qqp_extraction") as
    | PromptVersion
    | undefined;
  let qqpSystem: string;
  let qqpUserTemplate: string;
  let qqpIsDefault: boolean;
  let qqpPromptVersionId: string | null = null;

  if (qqpVersion && !isPlaceholder(qqpVersion.system_prompt)) {
    qqpSystem = qqpVersion.system_prompt;
    qqpUserTemplate = qqpVersion.user_template;
    qqpIsDefault = false;
    qqpPromptVersionId = qqpVersion.id;
  } else {
    qqpSystem = QQP_SYSTEM_PROMPT;
    qqpUserTemplate = QQP_USER_PROMPT_TEMPLATE;
    qqpIsDefault = true;
  }

  // Page classification and metadata: still from system_settings
  const { data: settings } = await admin
    .from("system_settings")
    .select("key, value")
    .in("key", ["prompt_page_classification", "prompt_metadata_extraction"]);

  const byKey = Object.fromEntries(
    (settings ?? []).map((s) => [s.key, unwrapValue(s.value)])
  );

  const rawPageClass = byKey["prompt_page_classification"];
  const pageClassIsDefault = !rawPageClass || isPlaceholder(rawPageClass);
  const pageClassification = pageClassIsDefault
    ? CLASSIFY_SYSTEM
    : rawPageClass;

  const rawMetadata = byKey["prompt_metadata_extraction"];
  const metadataIsDefault = !rawMetadata || isPlaceholder(rawMetadata);
  const metadataUser = metadataIsDefault ? METADATA_USER_TEMPLATE : rawMetadata;

  return {
    sqmSystem,
    sqmUser,
    qqpSystem,
    qqpUserTemplate,
    pageClassification,
    metadataUser,
    sqmPromptVersionId,
    qqpPromptVersionId,
    usingDefaults: {
      sqm: sqmIsDefault,
      qqp: qqpIsDefault,
      pageClassification: pageClassIsDefault,
      metadataUser: metadataIsDefault,
    },
  };
}
