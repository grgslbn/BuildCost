import { getPromptSettings } from "@/lib/ai/prompt-settings";
import {
  SQM_SYSTEM_PROMPT,
  SQM_USER_PROMPT,
  QQP_SYSTEM_PROMPT,
  QQP_USER_PROMPT_TEMPLATE,
} from "@/lib/ai/prompts";
import { CLASSIFY_SYSTEM } from "@/lib/pdf/classify-pages";
import { METADATA_USER_TEMPLATE } from "@/lib/pdf/extract-metadata";
import { PromptSettings } from "@/components/settings/prompt-settings";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminPromptsPage() {
  const loadedPrompts = await getPromptSettings();

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI Prompts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Customize the prompts used for each AI processing step. Changes take
          effect immediately — no redeployment needed. Click Save to persist;
          click Reset to restore the built-in defaults.
        </p>
      </div>

      <PromptSettings
        prompts={loadedPrompts}
        defaults={{
          sqmSystem: SQM_SYSTEM_PROMPT,
          sqmUser: SQM_USER_PROMPT,
          qqpSystem: QQP_SYSTEM_PROMPT,
          qqpUserTemplate: QQP_USER_PROMPT_TEMPLATE,
          pageClassification: CLASSIFY_SYSTEM,
          metadataUser: METADATA_USER_TEMPLATE,
        }}
      />
    </div>
  );
}
