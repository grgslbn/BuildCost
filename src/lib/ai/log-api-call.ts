import { createSupabaseAdminClient } from "@/lib/supabase/server";

export type ApiCallType =
  | "sqm_extraction"
  | "qqp_extraction"
  | "page_classification"
  | "metadata_extraction"
  | "prompt_update";

export type LogApiCallParams = {
  call_type: ApiCallType;
  dossier_id?: string | null;
  estimation_id?: string | null;
  model_used?: string | null;
  tokens_input?: number | null;
  tokens_output?: number | null;
  duration_ms: number;
  status: "success" | "error";
  error_message?: string | null;
};

// Fire-and-forget — never awaited so it adds zero latency to the calling route.
export function logApiCall(params: LogApiCallParams): void {
  const admin = createSupabaseAdminClient();
  const p = admin
    .from("api_call_log")
    .insert({
      call_type: params.call_type,
      dossier_id: params.dossier_id ?? null,
      estimation_id: params.estimation_id ?? null,
      model_used: params.model_used ?? null,
      tokens_input: params.tokens_input ?? null,
      tokens_output: params.tokens_output ?? null,
      duration_ms: params.duration_ms,
      status: params.status,
      error_message: params.error_message ?? null,
    });
  Promise.resolve(p).catch((e) => console.warn("[logApiCall] Failed:", e));
}
