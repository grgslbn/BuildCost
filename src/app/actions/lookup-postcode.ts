"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/server";

export type PostcodeLookupResult =
  | {
      found: true;
      postcode: string;
      municipality: string | null;
      region: string | null;
      basePrice: number;
      nationalBase: number;
      regionalCoeff: number;
    }
  | { found: false; nationalBase: number };

export async function lookupPostcode(
  postcode: string
): Promise<PostcodeLookupResult> {
  const admin = createSupabaseAdminClient();

  const [priceRes, settingsRes] = await Promise.all([
    admin
      .from("postcode_prices")
      .select("postcode, municipality, region, base_price_per_sqm")
      .eq("postcode", postcode.trim())
      .maybeSingle(),
    admin
      .from("system_settings")
      .select("value")
      .eq("key", "national_base_price_sqm")
      .single(),
  ]);

  const nationalBase = (settingsRes.data?.value as number) ?? 1450;

  if (!priceRes.data) {
    return { found: false, nationalBase };
  }

  const basePrice = Number(priceRes.data.base_price_per_sqm);
  return {
    found: true,
    postcode: priceRes.data.postcode,
    municipality: priceRes.data.municipality,
    region: priceRes.data.region,
    basePrice,
    nationalBase,
    regionalCoeff: nationalBase > 0 ? basePrice / nationalBase : 1,
  };
}
