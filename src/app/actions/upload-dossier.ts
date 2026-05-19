"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";

export type UploadDossierState =
  | { status: "idle" }
  | { status: "success"; id: string }
  | { status: "error"; message: string };

export async function uploadDossier(
  _prev: UploadDossierState,
  formData: FormData
): Promise<UploadDossierState> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { status: "error", message: "Not authenticated" };

  const admin = createSupabaseAdminClient();

  const userRow = await admin
    .from("users")
    .select("tenant_id")
    .eq("id", user.id)
    .single();

  if (userRow.error || !userRow.data?.tenant_id) {
    return { status: "error", message: "Could not resolve tenant" };
  }

  const tenantId: string = userRow.data.tenant_id;

  const file = formData.get("plan_file") as File | null;
  if (!file || file.size === 0) {
    return { status: "error", message: "Plan file is required" };
  }

  const dossierId = randomUUID();
  const ext = file.name.split(".").pop() ?? "pdf";
  const storagePath = `${tenantId}/${dossierId}/${file.name}`;

  const arrayBuffer = await file.arrayBuffer();
  const { error: storageError } = await admin.storage
    .from("plans")
    .upload(storagePath, arrayBuffer, {
      contentType: file.type || `image/${ext}`,
      upsert: false,
    });

  if (storageError) {
    return { status: "error", message: `Storage upload failed: ${storageError.message}` };
  }

  const address = formData.get("address") as string;
  const postcode = formData.get("postcode") as string;
  const buildingType = formData.get("building_type") as string;
  const knownTotalPrice = formData.get("known_total_price")
    ? Number(formData.get("known_total_price"))
    : null;
  const knownTotalSqm = formData.get("known_total_sqm")
    ? Number(formData.get("known_total_sqm"))
    : null;
  const knownPricePerSqm =
    knownTotalPrice && knownTotalSqm && knownTotalSqm > 0
      ? knownTotalPrice / knownTotalSqm
      : null;
  const finishingLevel = formData.get("finishing_level") as string;
  const abexYear = formData.get("abex_year")
    ? Number(formData.get("abex_year"))
    : null;
  const abexSemester = formData.get("abex_semester")
    ? Number(formData.get("abex_semester"))
    : null;
  const rawNotes = (formData.get("expert_notes") as string) || "";
  const abexSuffix =
    abexYear && abexSemester ? `\n\n[ABEX ref: ${abexYear} S${abexSemester}]` : "";
  const expertNotes = rawNotes + abexSuffix || null;

  const { error: dbError } = await admin.from("reference_dossiers").insert({
    id: dossierId,
    tenant_id: tenantId,
    address: address || null,
    postcode: postcode || null,
    building_type: buildingType || null,
    known_total_price: knownTotalPrice,
    known_total_sqm: knownTotalSqm,
    known_price_per_sqm: knownPricePerSqm,
    expert_finishing_level: finishingLevel || null,
    expert_notes: expertNotes,
    plan_storage_path: storagePath,
    plan_file_name: file.name,
    plan_file_type: ext,
    status: "pending",
  });

  if (dbError) {
    await admin.storage.from("plans").remove([storagePath]);
    return { status: "error", message: `Database insert failed: ${dbError.message}` };
  }

  revalidatePath("/admin/dossiers");
  return { status: "success", id: dossierId };
}
