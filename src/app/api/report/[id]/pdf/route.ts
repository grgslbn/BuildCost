import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

// ── Types ─────────────────────────────────────────────────────────────────────

type EstRow = {
  id: string;
  status: string;
  building_type: string | null;
  postcode: string | null;
  created_at: string | null;
  total_livable_sqm: number | null;
  total_gross_sqm: number | null;
  finishing_level: string | null;
  finishing_coefficient: number | null;
  estimated_total_cost: number | null;
  overall_confidence: number | null;
  sub_areas: CostBreakdown | null;
  sqm_extraction: SqmExt | null;
};

type CostBreakdown = {
  cat1_sqm?: number; cat1_price_per_sqm?: number; cat1_cost?: number;
  cat2_sqm?: number; cat2_price_per_sqm?: number; cat2_cost?: number;
  cat3_sqm?: number; cat3_price_per_sqm?: number; cat3_cost?: number;
  subtotal?: number; regional_factor?: number; abex_factor?: number;
};

type Room   = { label?: string; label_en?: string; area_sqm?: number };
type Floor  = { label_en?: string; label?: string; rooms?: Room[] };
type Bldg   = { floors?: Floor[] };
type SqmExt = { floors?: Floor[]; buildings?: Bldg[] };

// ── Helpers ───────────────────────────────────────────────────────────────────

const ACCENT   = rgb(0.784, 0.353, 0.165); // #C85A2A
const DARK     = rgb(0.102, 0.090, 0.078); // #1A1714
const MID      = rgb(0.322, 0.282, 0.251); // #524840
const LIGHT    = rgb(0.612, 0.565, 0.533); // #9C9088
const BG_TINT  = rgb(0.949, 0.929, 0.910); // #F2EDE8
const BORDER   = rgb(0.910, 0.878, 0.847); // #E8E0D8

function fmtEur(v: number | null | undefined): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(v));
}
function fmtSqm(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${Number(v).toFixed(1)} m²`;
}
function finishingLabel(coeff: number | null): string {
  if (coeff == null) return "—";
  if (coeff < 0.85) return "Basic";
  if (coeff < 1.0)  return "Standard";
  if (coeff < 1.15) return "Comfort";
  if (coeff < 1.30) return "Comfort+";
  return "Luxury";
}
function confidenceLabel(v: number | null): string {
  if (v == null) return "—";
  if (v >= 0.8) return "High";
  if (v >= 0.6) return "Medium";
  return "Low";
}

// ── PDF drawing helpers ───────────────────────────────────────────────────────

const W = 595; // A4 width
const H = 842; // A4 height
const ML = 48; // margin left
const MR = 48; // margin right
const INNER = W - ML - MR;

interface DrawCtx {
  page: PDFPage;
  regular: PDFFont;
  bold: PDFFont;
  y: number;
}

function text(ctx: DrawCtx, str: string, opts: {
  x?: number; size?: number; font?: "regular" | "bold";
  color?: ReturnType<typeof rgb>; maxWidth?: number;
}) {
  const font  = opts.font === "bold" ? ctx.bold : ctx.regular;
  const size  = opts.size ?? 10;
  const color = opts.color ?? DARK;
  const x     = opts.x ?? ML;

  // Truncate if too long
  let displayStr = str;
  if (opts.maxWidth) {
    while (displayStr.length > 1 && font.widthOfTextAtSize(displayStr, size) > opts.maxWidth) {
      displayStr = displayStr.slice(0, -1);
    }
    if (displayStr.length < str.length) displayStr = displayStr.slice(0, -1) + "…";
  }

  ctx.page.drawText(displayStr, { x, y: ctx.y, size, font, color });
}

function line(ctx: DrawCtx, x1: number, x2: number, thickness = 0.5, color = BORDER) {
  ctx.page.drawLine({ start: { x: x1, y: ctx.y }, end: { x: x2, y: ctx.y }, thickness, color });
}

function rect(ctx: DrawCtx, x: number, w: number, h: number, color: ReturnType<typeof rgb>, yOffset = 0) {
  ctx.page.drawRectangle({ x, y: ctx.y + yOffset, width: w, height: h, color });
}

function textRight(ctx: DrawCtx, str: string, opts: {
  rightX: number; size?: number; font?: "regular" | "bold";
  color?: ReturnType<typeof rgb>;
}) {
  const font  = opts.font === "bold" ? ctx.bold : ctx.regular;
  const size  = opts.size ?? 10;
  const color = opts.color ?? DARK;
  const w     = font.widthOfTextAtSize(str, size);
  ctx.page.drawText(str, { x: opts.rightX - w, y: ctx.y, size, font, color });
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const admin = createSupabaseAdminClient();

  const { data: est, error } = await admin
    .from("estimations")
    .select([
      "id", "status",
      "building_type", "postcode", "created_at",
      "total_livable_sqm", "total_gross_sqm",
      "finishing_level", "finishing_coefficient",
      "estimated_total_cost", "overall_confidence",
      "sub_areas", "sqm_extraction",
    ].join(", "))
    .eq("id", params.id)
    .eq("status", "complete")
    .single();

  if (error || !est) {
    return new NextResponse("Estimation not found or not complete", { status: 404 });
  }

  const e = est as unknown as EstRow;
  const bd        = e.sub_areas;
  const sqmExt    = e.sqm_extraction;
  const floors: Floor[] = sqmExt
    ? (sqmExt.buildings?.flatMap(b => b.floors ?? []) ?? sqmExt.floors ?? [])
    : [];
  const allRooms: Room[] = floors.flatMap(f => f.rooms ?? []);

  // ── Build PDF ────────────────────────────────────────────────────────────────

  const doc      = await PDFDocument.create();
  const regular  = await doc.embedFont(StandardFonts.Helvetica);
  const bold     = await doc.embedFont(StandardFonts.HelveticaBold);

  // Decide how many pages we need (rough estimate)
  const roomsPerPage = 22;
  const estimatedRoomPages = Math.ceil(Math.max(0, allRooms.length - 8) / roomsPerPage);
  const totalPages = 1 + estimatedRoomPages;

  const pages: PDFPage[] = [];
  for (let i = 0; i < totalPages; i++) {
    pages.push(doc.addPage([W, H]));
  }

  let pageIdx = 0;
  const ctx: DrawCtx = { page: pages[0], regular, bold, y: H - 48 };

  function ensureSpace(needed: number) {
    if (ctx.y - needed < 60) {
      pageIdx += 1;
      if (pageIdx < pages.length) {
        ctx.page = pages[pageIdx];
        ctx.y = H - 48;
        // Repeat footer hint
        drawFooter(ctx);
        ctx.y = H - 48;
      }
    }
  }

  function drawFooter(c: DrawCtx) {
    const savedY = c.y;
    c.y = 36;
    line(c, ML, W - MR, 0.5, BORDER);
    c.y = 24;
    text(c, "Plan Based · planbased.xyz", { size: 8, color: LIGHT });
    text(c, "AI-generated estimate — for official valuations, consult a certified expert.", { x: ML + 140, size: 8, color: LIGHT });
    c.y = savedY;
  }

  // ── Page 1: Header ───────────────────────────────────────────────────────────

  // Brand header
  text(ctx, "Plan Based", { font: "bold", size: 20, color: DARK });
  // Dot after brand
  ctx.page.drawCircle({ x: ML + bold.widthOfTextAtSize("Plan Based", 20) + 5, y: ctx.y + 14, size: 3, color: ACCENT });
  text(ctx, "Building Reconstruction Estimate", { x: ML, size: 10, color: LIGHT });
  textRight(ctx, `Generated: ${e.created_at ? new Date(e.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—"}`, { rightX: W - MR, size: 9, color: LIGHT });

  ctx.y -= 6;
  line(ctx, ML, W - MR, 1, ACCENT);
  ctx.y -= 28;

  // ── Hero cost ────────────────────────────────────────────────────────────────

  rect(ctx, ML, INNER, 80, rgb(0.980, 0.910, 0.863), -4);
  ctx.y += 20;
  text(ctx, "ESTIMATED REBUILD COST", { x: ML + 16, size: 8, font: "bold", color: ACCENT });
  ctx.y -= 22;
  text(ctx, fmtEur(e.estimated_total_cost), { x: ML + 16, size: 28, font: "bold", color: ACCENT });
  ctx.y -= 6;

  // Inline metadata under the big number
  const meta: string[] = [];
  if (e.building_type) meta.push(e.building_type.replace(/_/g, " "));
  if (e.postcode) meta.push(`Postcode ${e.postcode}`);
  if (e.finishing_coefficient) meta.push(`${finishingLabel(e.finishing_coefficient)} finishing (F=${Number(e.finishing_coefficient).toFixed(2)})`);
  if (e.overall_confidence != null) meta.push(`Confidence: ${confidenceLabel(e.overall_confidence)}`);
  text(ctx, meta.join("  ·  "), { x: ML + 16, size: 9, color: MID, maxWidth: INNER - 32 });
  ctx.y -= 30;

  // ── Area summary row ─────────────────────────────────────────────────────────

  const areaCols = [
    { label: "Total area", value: fmtSqm(e.total_gross_sqm ?? e.total_livable_sqm) },
    { label: "Livable area", value: fmtSqm(e.total_livable_sqm) },
    { label: "CAT2 area", value: fmtSqm(bd?.cat2_sqm) },
    { label: "CAT3 area", value: fmtSqm(bd?.cat3_sqm) },
  ];
  const colW = INNER / areaCols.length;
  areaCols.forEach((col, i) => {
    const cx = ML + i * colW;
    text(ctx, col.label, { x: cx, size: 8, color: LIGHT });
    ctx.y -= 14;
    text(ctx, col.value, { x: cx, size: 11, font: "bold", color: DARK });
    ctx.y += 14;
  });
  ctx.y -= 22;
  line(ctx, ML, W - MR);
  ctx.y -= 18;

  // ── Cost breakdown ───────────────────────────────────────────────────────────

  if (bd) {
    text(ctx, "COST BREAKDOWN", { font: "bold", size: 10, color: DARK });
    ctx.y -= 14;

    // Column headers
    rect(ctx, ML, INNER, 16, BG_TINT, -2);
    text(ctx, "Category", { size: 8, font: "bold", color: LIGHT });
    textRight(ctx, "Area", { rightX: ML + 230, size: 8, font: "bold", color: LIGHT });
    textRight(ctx, "Price/m²", { rightX: ML + 310, size: 8, font: "bold", color: LIGHT });
    textRight(ctx, "Cost", { rightX: W - MR, size: 8, font: "bold", color: LIGHT });
    ctx.y -= 18;

    const breakdown = [
      { label: "Livable area (CAT1)", sqm: bd.cat1_sqm, price: bd.cat1_price_per_sqm, cost: bd.cat1_cost },
      { label: "Enclosed non-livable (CAT2)", sqm: bd.cat2_sqm, price: bd.cat2_price_per_sqm, cost: bd.cat2_cost },
      { label: "Outdoor built (CAT3)", sqm: bd.cat3_sqm, price: bd.cat3_price_per_sqm, cost: bd.cat3_cost },
    ];

    breakdown.forEach((row) => {
      line(ctx, ML, W - MR, 0.3, BORDER);
      ctx.y -= 14;
      text(ctx, row.label, { size: 10, color: MID, maxWidth: 180 });
      textRight(ctx, fmtSqm(row.sqm), { rightX: ML + 230, size: 10, color: MID });
      textRight(ctx, row.price != null ? `${fmtEur(row.price)}/m²` : "—", { rightX: ML + 310, size: 10, color: MID });
      textRight(ctx, fmtEur(row.cost), { rightX: W - MR, size: 10, font: "bold", color: DARK });
      ctx.y -= 6;
    });

    // Subtotal
    ctx.y -= 2;
    line(ctx, ML, W - MR, 1, BORDER);
    ctx.y -= 14;
    const sub = bd.subtotal ?? ((bd.cat1_cost ?? 0) + (bd.cat2_cost ?? 0) + (bd.cat3_cost ?? 0));
    text(ctx, "Subtotal", { size: 10, font: "bold", color: DARK });
    textRight(ctx, fmtEur(sub), { rightX: W - MR, size: 10, font: "bold", color: DARK });
    ctx.y -= 8;

    // Adjustments
    if (bd.regional_factor != null && bd.regional_factor !== 1) {
      line(ctx, ML, W - MR, 0.3, BORDER);
      ctx.y -= 13;
      text(ctx, `× Regional adjustment (${Number(bd.regional_factor).toFixed(3)})`, { size: 9, color: MID });
      textRight(ctx, fmtEur(sub * Number(bd.regional_factor)), { rightX: W - MR, size: 9, color: MID });
      ctx.y -= 4;
    }
    if (bd.abex_factor != null) {
      line(ctx, ML, W - MR, 0.3, BORDER);
      ctx.y -= 13;
      text(ctx, `× ABEX index (${Number(bd.abex_factor).toFixed(3)})`, { size: 9, color: MID });
      ctx.y -= 4;
    }

    // Total
    line(ctx, ML, W - MR, 1.5, ACCENT);
    ctx.y -= 16;
    rect(ctx, ML, INNER, 22, rgb(1, 0.976, 0.965), -4);
    text(ctx, "TOTAL REBUILD COST", { size: 11, font: "bold", color: DARK });
    textRight(ctx, fmtEur(e.estimated_total_cost), { rightX: W - MR, size: 14, font: "bold", color: ACCENT });
    ctx.y -= 20;

    line(ctx, ML, W - MR, 0.5, BORDER);
    ctx.y -= 18;
  }

  // ── Room breakdown ───────────────────────────────────────────────────────────

  if (allRooms.length > 0) {
    ensureSpace(40);
    text(ctx, "ROOM BREAKDOWN", { font: "bold", size: 10, color: DARK });
    ctx.y -= 14;

    // Column headers
    rect(ctx, ML, INNER, 16, BG_TINT, -2);
    text(ctx, "Room", { size: 8, font: "bold", color: LIGHT });
    textRight(ctx, "Area", { rightX: W - MR, size: 8, font: "bold", color: LIGHT });
    ctx.y -= 18;

    for (const floor of floors) {
      const rooms = floor.rooms ?? [];
      if (rooms.length === 0) continue;

      const floorLabel = floor.label_en ?? floor.label ?? "Floor";
      ensureSpace(24 + rooms.length * 18);

      // Floor header
      rect(ctx, ML, INNER, 14, BG_TINT, -2);
      text(ctx, floorLabel.toUpperCase(), { size: 8, font: "bold", color: MID });
      const floorTotal = rooms.reduce((s, r) => s + (r.area_sqm ?? 0), 0);
      textRight(ctx, fmtSqm(floorTotal), { rightX: W - MR, size: 8, color: MID });
      ctx.y -= 16;

      for (const room of rooms) {
        line(ctx, ML, W - MR, 0.3, BORDER);
        ctx.y -= 13;
        text(ctx, room.label_en ?? room.label ?? "Room", { size: 9.5, color: MID, maxWidth: INNER - 80 });
        textRight(ctx, fmtSqm(room.area_sqm), { rightX: W - MR, size: 9.5, font: "bold", color: DARK });
        ctx.y -= 4;
      }
      ctx.y -= 6;
    }
  }

  // ── Footer on all pages ──────────────────────────────────────────────────────

  for (let i = 0; i < pages.length; i++) {
    ctx.page = pages[i];
    drawFooter(ctx);
    // Page number
    ctx.y = 24;
    textRight(ctx, `${i + 1} / ${pages.length}`, { rightX: W - MR, size: 8, color: LIGHT });
  }

  // ── Respond ──────────────────────────────────────────────────────────────────

  const pdfBytes = await doc.save();
  const shortId  = params.id.slice(0, 8);

  // pdf-lib returns Uint8Array; Buffer extends Uint8Array and is accepted by NextResponse
  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="plan-based-estimate-${shortId}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
