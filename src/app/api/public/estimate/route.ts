import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { PUBLIC_TENANT_ID } from "@/lib/dev-auth";
import { checkPublicEstimationLimit } from "@/lib/public-rate-limit";

export const dynamic = "force-dynamic";

// Creates an estimation row in the PUBLIC_TENANT and validates it, then
// returns the estimationId so the client can fire /api/estimate-process.
export async function POST(req: NextRequest) {
  const admin = createSupabaseAdminClient();

  const limit = await checkPublicEstimationLimit(req);
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message:
          "You've reached the limit for free estimates. Contact us for unlimited access.",
        retryAfterSeconds: limit.retryAfterSeconds,
      },
      { status: 429 }
    );
  }

  const body = (await req.json()) as {
    storagePath?: string;
    fileName?: string;
    postcode?: string;
  };

  if (!body.storagePath || !body.fileName || !body.postcode) {
    return NextResponse.json(
      { error: "Missing storagePath, fileName, or postcode" },
      { status: 400 }
    );
  }

  const { data, error } = await admin
    .from("estimations")
    .insert({
      tenant_id: PUBLIC_TENANT_ID,
      created_by: null,
      plan_storage_path: body.storagePath,
      plan_file_name: body.fileName,
      postcode: body.postcode.trim(),
      postcode_provided_by: "user",
      status: "uploading",
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create estimation" },
      { status: 500 }
    );
  }

  return NextResponse.json({ estimationId: data.id });
}
