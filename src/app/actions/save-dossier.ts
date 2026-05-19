"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { SKIP_AUTH, DEV_TENANT_ID } from "@/lib/dev-auth";
import type { PageClassification } from "@/lib/pdf/classify-pages";

export type SaveDossierInput = {
  dossierId: string;
  storagePath: string;
  fileName: string;
  fileType: string;
  pageClassifications: PageClassification[] | null;
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

export type SaveDossierResult =
  | { status: "success"; id: string }
  | { status: "error"; message: string };

export async function saveDossier(input: SaveDossierInput): Promise<SaveDossierResult> {
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
  const expertNotes = input.expert_notes ? input.expert_notes + abexSuffix : null;

  const admin = createSupabaseAdminClient();

  const { error } = await admin.from("reference_dossiers").insert({
    id: input.dossierId,
    tenant_id: tenantId,
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
    plan_storage_path: input.storagePath,
    plan_file_name: input.fileName,
    plan_file_type: input.fileType,
    page_classifications: input.pageClassifications ?? null,
    status: "pending",
  });

  if (error) {
    await admin.storage.from("plans").remove([input.storagePath]);
    return { status: "error", message: `Database insert failed: ${error.message}` };
  }

  revalidatePath("/admin/dossiers");
  return { status: "success", id: input.dossierId };
}
