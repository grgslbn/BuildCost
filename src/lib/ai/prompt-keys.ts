export const PROMPT_SEPARATOR = "\n\n===USER===\n\n";

export const PROMPT_KEYS = [
  "prompt_sqm_extraction",
  "prompt_qqp_extraction",
  "prompt_page_classification",
  "prompt_metadata_extraction",
] as const;

export type PromptKey = (typeof PROMPT_KEYS)[number];
