"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { SKIP_AUTH, DEV_TENANT_ID } from "@/lib/dev-auth";

export type UpdateDossierInput = {
  dossierId: string;
  address: string;
  postcode: string;
  building_type: string;
  known_total_price: string;
  known_total_sqm: string;
  finishing_level: string;
  abex_year: string;
  abex_semester: string;
  expert_notes: string;
};

export type UpdateDossierResult =
  | { status: "success" }
  | { status: "error"; message: string };

export async function updateDossier(input: UpdateDossierInput): Promise<UpdateDossierResult> {
  let tenantId: string;

  if (SKIP_AUTH) {
    tenantId = DEV_TENANT_ID;
  } else {
    const supabase = createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { status: "error", message: "Not authenticated" };

    const { data: userRow } = await createSupabaseAdminClient()
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!userRow?.tenant_id) {
      return { status: "error", message: "Could not resolve tenant" };
    }
    tenantId = userRow.tenant_id;
  }

  const knownTotalPrice = input.known_total_price ? Number(input.known_total_price) : null;
  const knownTotalSqm = input.known_total_sqm ? Number(input.known_total_sqm) : null;
  const knownPricePerSqm =
    knownTotalPrice && knownTotalSqm && knownTotalSqm > 0
      ? knownTotalPrice / knownTotalSqm
      : null;

  const abexYear = input.abex_year ? Number(input.abex_year) : null;
  const abexSemester = input.abex_semester ? Number(input.abex_semester) : null;
  const abexSuffix =
    abexYear && abexSemester ? `\n\n[ABEX ref: ${abexYear} S${abexSemester}]` : "";
  // Strip any existing ABEX suffix before appending
  const notesBase = input.expert_notes.replace(/\n\n\[ABEX ref:[^\]]*\]$/, "").trim();
  const expertNotes = notesBase
    ? notesBase + abexSuffix
    : abexSuffix.trim() || null;

  const admin = createSupabaseAdminClient();

  const { error } = await admin
    .from("reference_dossiers")
    .update({
      address: input.address || null,
      postcode: input.postcode || null,
      building_type: input.building_type || null,
      known_total_price: knownTotalPrice,
      known_total_sqm: knownTotalSqm,
      known_price_per_sqm: knownPricePerSqm,
      expert_finishing_level: input.finishing_level || null,
      expert_notes: expertNotes,
      price_abex_year: abexYear,
      price_abex_semester: abexSemester,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.dossierId)
    .eq("tenant_id", tenantId);

  if (error) {
    return { status: "error", message: `Update failed: ${error.message}` };
  }

  revalidatePath(`/admin/dossiers/${input.dossierId}`);
  revalidatePath("/admin/dossiers");
  return { status: "success" };
}
