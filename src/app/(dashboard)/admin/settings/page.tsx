import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { Separator } from "@/components/ui/separator";
import { FeaturedSettings } from "@/components/settings/featured-settings";
import { SettingsSection } from "@/components/settings/settings-section";
import {
  RegionalCoefficientsTable,
  type PostcodePrice,
} from "@/components/settings/regional-table";
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
  "national_base_price_sqm",
  "abex_reference_year",
  "abex_reference_semester",
]);

export default async function AdminSettingsPage() {
  const admin = createSupabaseAdminClient();

  const [settingsRes, postcodeRes] = await Promise.all([
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

  return (
    <div className="mx-auto max-w-3xl space-y-10 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure pricing, QQP engine parameters, and processing behaviour.
          Changes auto-save on blur.
        </p>
      </div>

      {/* Featured: National Base Price + ABEX Reference */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Key Parameters</h2>
        <FeaturedSettings
          basePrice={byKey["national_base_price_sqm"]}
          abexYear={byKey["abex_reference_year"]}
          abexSemester={byKey["abex_reference_semester"]}
          basePriceMin={byKey["national_base_price_min"] ?? null}
          basePriceMax={byKey["national_base_price_max"] ?? null}
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
    </div>
  );
}
