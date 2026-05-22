import { NextRequest, NextResponse } from "next/server";
import { sendReportForLead } from "@/lib/email/send-report";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { leadId?: string };
  if (!body.leadId) {
    return NextResponse.json({ error: "Missing leadId" }, { status: 400 });
  }

  const result = await sendReportForLead(body.leadId);

  if (result.status === "error") {
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json(result);
}
