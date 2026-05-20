import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { Separator } from "@/components/ui/separator";
import { FeaturedSettings } from "@/components/settings/featured-settings";
import { SettingsSection } from "@/components/settings/settings-section";
import {
  RegionalCoefficientsTable,
  type PostcodePrice,
} from "@/components/settings/regional-table";
import { PromptSettings } from "@/components/settings/prompt-settings";
import { getPromptSettings } from "@/lib/ai/prompt-settings";
import {
  SQM_SYSTEM_PROMPT,
  SQM_USER_PROMPT,
  QQP_SYSTEM_PROMPT,
  QQP_USER_PROMPT_TEMPLATE,
} from "@/lib/ai/prompts";
import { CLASSIFY_SYSTEM } from "@/lib/pdf/classify-pages";
import { METADATA_USER_TEMPLATE } from "@/lib/pdf/extract-metadata";
import type { SettingRowData } from "@/components/settings/setting-row";

export const dynamic = "force-dynamic";

const CATEGORY_META: Record<string, { title: string; description: string }> = {
  pricing: {
    title: "Pricing",
    description: "Base prices, ABEX index settings, and regional coefficient configuration.",
  },
  qqp: {
    title: "QQP Engine",
    description: "Finishing coefficient bounds, QQP discovery thresholds, and model weights.",
  },
  processing: {
    title: "Processing",
    description: "AI model selection, retry limits, and confidence thresholds.",
  },
};

const FEATURED_KEYS = new Set([
  "cat1_price_min",
  "cat1_price_max",
  "cat2_price_min",
  "cat2_price_max",
  "cat3_price_min",
  "cat3_price_max",
  "abex_reference_year",
  "abex_reference_semester",
]);

export default async function AdminSettingsPage() {
  const admin = createSupabaseAdminClient();

  const [settingsRes, postcodeRes, loadedPrompts] = await Promise.all([
    admin
      .from("system_settings")
      .select("key, value, display_name, description, category, updated_at")
      .order("category")
      .order("key"),
    admin
      .from("postcode_prices")
      .select("postcode, municipality, province, region, base_price_per_sqm, year")
      .order("region")
      .order("postcode"),
    getPromptSettings(),
  ]);

  const allSettings: SettingRowData[] = (settingsRes.data ?? []).map((s) => ({
    key: s.key,
    value: s.value,
    display_name: s.display_name,
    description: s.description,
    category: s.category,
    updated_at: s.updated_at,
  }));

  const byKey = Object.fromEntries(allSettings.map((s) => [s.key, s]));
  const postcodePrices: PostcodePrice[] = (postcodeRes.data ?? []) as PostcodePrice[];

  const categories = Object.keys(CATEGORY_META);
  const settingsByCategory: Record<string, SettingRowData[]> = {};
  for (const cat of categories) {
    settingsByCategory[cat] = allSettings.filter(
      (s) => s.category === cat && !FEATURED_KEYS.has(s.key)
    );
  }

  const fallback = (key: string, displayName: string, defaultVal: number): SettingRowData => ({
    key,
    value: defaultVal,
    display_name: displayName,
    description: "",
    category: "pricing",
    updated_at: new Date().toISOString(),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-10 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure pricing, QQP engine parameters, and processing behaviour.
          Changes auto-save on blur.
        </p>
      </div>

      {/* Featured: Category Pricing + ABEX Reference */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Key Parameters</h2>
        <FeaturedSettings
          cat1Min={byKey["cat1_price_min"] ?? fallback("cat1_price_min", "CAT1 Min Price (€/m²)", 1100)}
          cat1Max={byKey["cat1_price_max"] ?? fallback("cat1_price_max", "CAT1 Max Price (€/m²)", 1900)}
          cat2Min={byKey["cat2_price_min"] ?? fallback("cat2_price_min", "CAT2 Min Price (€/m²)", 550)}
          cat2Max={byKey["cat2_price_max"] ?? fallback("cat2_price_max", "CAT2 Max Price (€/m²)", 950)}
          cat3Min={byKey["cat3_price_min"] ?? fallback("cat3_price_min", "CAT3 Min Price (€/m²)", 330)}
          cat3Max={byKey["cat3_price_max"] ?? fallback("cat3_price_max", "CAT3 Max Price (€/m²)", 570)}
          abexYear={byKey["abex_reference_year"] ?? fallback("abex_reference_year", "ABEX Reference Year", 2026)}
          abexSemester={byKey["abex_reference_semester"] ?? fallback("abex_reference_semester", "ABEX Reference Semester", 1)}
        />
      </section>

      <Separator />

      {/* Settings by category */}
      {categories.map((cat) => (
        <SettingsSection
          key={cat}
          title={CATEGORY_META[cat].title}
          description={CATEGORY_META[cat].description}
          settings={settingsByCategory[cat] ?? []}
        />
      ))}

      <Separator />

      {/* Regional coefficients (read-only) */}
      <RegionalCoefficientsTable rows={postcodePrices} />

      <Separator />

      {/* AI Prompts */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">AI Prompts</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Customize the prompts used for each AI processing step. Changes take effect immediately — no redeployment needed. Click Save to persist; click Reset to restore the built-in defaults.
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
      </section>
    </div>
  );
}
