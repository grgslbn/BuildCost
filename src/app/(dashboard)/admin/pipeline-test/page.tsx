import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { PipelineTestClient } from "./pipeline-test-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PipelineTestPage() {
  const admin = createSupabaseAdminClient();

  const [estRes, dossierRes] = await Promise.all([
    admin
      .from("estimations")
      .select("id, plan_file_name, status, estimated_total_cost, tenant_id")
      .order("created_at", { ascending: false })
      .limit(20),
    admin
      .from("reference_dossiers")
      .select("id, plan_file_name, status, postcode")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return (
    <PipelineTestClient
      estimations={(estRes.data ?? []) as EstimationOption[]}
      dossiers={(dossierRes.data ?? []) as DossierOption[]}
    />
  );
}

export type EstimationOption = {
  id: string;
  plan_file_name: string | null;
  status: string;
  estimated_total_cost: string | null;
  tenant_id: string;
};

export type DossierOption = {
  id: string;
  plan_file_name: string | null;
  status: string;
  postcode: string | null;
};
