import { createSupabaseAdminClient } from "@/lib/supabase/server";
import {
  SQM_SYSTEM_PROMPT,
  SQM_USER_PROMPT,
  QQP_SYSTEM_PROMPT,
  QQP_USER_PROMPT_TEMPLATE,
} from "./prompts";
import { CLASSIFY_SYSTEM } from "@/lib/pdf/classify-pages";
import { METADATA_USER_TEMPLATE } from "@/lib/pdf/extract-metadata";
import { PROMPT_KEYS, PROMPT_SEPARATOR } from "./prompt-keys";

export { PROMPT_SEPARATOR, PROMPT_KEYS };
export type { PromptKey } from "./prompt-keys";

export type LoadedPrompts = {
  sqmSystem: string;
  sqmUser: string;
  qqpSystem: string;
  qqpUserTemplate: string;
  pageClassification: string;
  metadataUser: string;
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

// Real prompts for these tasks are several hundred characters minimum.
const MIN_REAL_PROMPT_LENGTH = 80;

function isPlaceholder(value: string): boolean {
  if (!value || value.length < MIN_REAL_PROMPT_LENGTH) return true;
  return PLACEHOLDER_PATTERNS.some((p) => value.includes(p));
}

function splitPrompt(
  raw: string | undefined,
  defaultSystem: string,
  defaultUser: string
): [string, string, boolean] {
  if (!raw || isPlaceholder(raw)) return [defaultSystem, defaultUser, true];
  const idx = raw.indexOf(PROMPT_SEPARATOR);
  if (idx === -1) return [raw, defaultUser, false];
  return [raw.slice(0, idx), raw.slice(idx + PROMPT_SEPARATOR.length), false];
}

// Unwraps a value that may have been stored via JSON.stringify() (new format)
// or as a plain JSONB string (old format). Returns the raw string either way.
function unwrapValue(raw: unknown): string {
  if (typeof raw !== "string") return "";
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
  } catch {
    // old row: plain string stored directly in JSONB, no double-encoding
  }
  return raw;
}

export async function getPromptSettings(): Promise<LoadedPrompts> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("system_settings")
    .select("key, value")
    .in("key", [...PROMPT_KEYS]);

  const byKey = Object.fromEntries(
    (data ?? []).map((s) => [s.key, unwrapValue(s.value)])
  );

  const [sqmSystem, sqmUser, sqmIsDefault] = splitPrompt(
    byKey["prompt_sqm_extraction"],
    SQM_SYSTEM_PROMPT,
    SQM_USER_PROMPT
  );
  const [qqpSystem, qqpUserTemplate, qqpIsDefault] = splitPrompt(
    byKey["prompt_qqp_extraction"],
    QQP_SYSTEM_PROMPT,
    QQP_USER_PROMPT_TEMPLATE
  );

  const rawPageClass = byKey["prompt_page_classification"];
  const pageClassIsDefault = !rawPageClass || isPlaceholder(rawPageClass);
  const pageClassification = pageClassIsDefault ? CLASSIFY_SYSTEM : rawPageClass;

  const rawMetadata = byKey["prompt_metadata_extraction"];
  const metadataIsDefault = !rawMetadata || isPlaceholder(rawMetadata);
  const metadataUser = metadataIsDefault ? METADATA_USER_TEMPLATE : rawMetadata;

  return {
    sqmSystem, sqmUser,
    qqpSystem, qqpUserTemplate,
    pageClassification, metadataUser,
    usingDefaults: {
      sqm:              sqmIsDefault,
      qqp:              qqpIsDefault,
      pageClassification: pageClassIsDefault,
      metadataUser:     metadataIsDefault,
    },
  };
}
