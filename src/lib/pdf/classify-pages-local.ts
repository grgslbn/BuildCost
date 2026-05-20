/**
 * Local PDF page classifier using mupdf text extraction + keyword heuristics.
 * Ported from WS1 benchmark pipeline (pdf-classifier.mjs).
 *
 * Zero API cost, fast, and reliable for Belgian building plans.
 * Replaces the Claude Vision classifier for floor plan detection.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mupdfMod: any = null;

async function ensureMupdf() {
  if (!mupdfMod) mupdfMod = await import("mupdf");
}

// ── Keyword patterns (from WS1 pdf-classifier.mjs) ─────────────────────────

const PLAN_KEYWORDS = [
  /grondplan/i, /gelijkvloers/i, /verdieping/i, /kelder/i,
  /slaapkamer/i, /badkamer/i, /keuken/i, /woonkamer/i, /leefruimte/i,
  /berging/i, /garage/i, /inkomhal/i, /trappenhal/i,
  /\bBO\s+[\d,\.]+/i, /\bNO\s+[\d,\.]+/i,
  /schaal\s*1\s*[:/]\s*\d+/i, /1\/\d+/,
];

const PLAN_STRONG = [
  /grondplan\s*[+\-]?\s*\d+/i,
  /plan\s+(gelijkvloers|verdieping|kelder)/i,
  /\bBO\s+[\d,\.]+\s*m/i,
];

const SECTION_KEYWORDS = [
  /doorsnede/i, /snede/i, /coupe/i, /section/i,
  /gevelaanzicht/i, /gevelbekleding/i, /facade/i,
];

const ADMIN_KEYWORDS = [
  /aanbieder/i, /verzekeringsaanvraag/i, /polishouder/i,
  /dossiernummer/i, /inspectiedatum/i,
  /digitale handtekening/i, /ondertekend/i,
  /foto\s*\d+/i,
  /@[\w.-]+\.\w+/,
  /van:\s*\w+/i, /aan:\s*\w+/i,
];

const DRAINAGE_KEYWORDS = [
  /funderings.*plan/i, /rioleringsplan/i, /drainage/i,
  /septische put/i, /hemelwater/i, /regenwaterput/i,
];

// ── Types ────────────────────────────────────────────────────────────────────

export type LocalPageType =
  | "floor_plan"
  | "section_elevation"
  | "drainage_plan"
  | "admin"
  | "photo_or_blank"
  | "unknown";

export type LocalPageClassification = {
  pageNumber: number;
  type: LocalPageType;
  confidence: number;
  isLandscape: boolean;
  width: number;
  height: number;
  textLength: number;
  floorLabels: string[];
  multiPlan: boolean;
};

// ── Classifier ───────────────────────────────────────────────────────────────

/**
 * Classify all pages in a PDF using local text extraction + keyword heuristics.
 * Identical logic to WS1's pdf-classifier.mjs but uses mupdf instead of pdfjs-dist.
 */
export async function classifyPagesLocal(
  pdfBuffer: Buffer,
  maxPages = 40
): Promise<{ pages: LocalPageClassification[]; totalPages: number }> {
  await ensureMupdf();
  const mupdf = mupdfMod!;

  const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf");
  const totalPages = doc.countPages();
  const pageLimit = Math.min(totalPages, maxPages);
  const pages: LocalPageClassification[] = [];

  for (let i = 0; i < pageLimit; i++) {
    try {
      const page = doc.loadPage(i);
      const bounds = page.getBounds(); // [x0, y0, x1, y1]
      const width = Math.round(bounds[2] - bounds[0]);
      const height = Math.round(bounds[3] - bounds[1]);
      const isLandscape = width > height * 1.2;

      // Extract text from page
      let text = "";
      try {
        const sText = page.toStructuredText("preserve-whitespace");
        text = sText.asText();
      } catch {
        // Some pages may not have text (scanned images)
        text = "";
      }

      const textLen = text.length;

      // Score keywords
      const planHits = PLAN_KEYWORDS.filter((p) => p.test(text)).length;
      const strongHits = PLAN_STRONG.filter((p) => p.test(text)).length;
      const sectionHits = SECTION_KEYWORDS.filter((p) => p.test(text)).length;
      const adminHits = ADMIN_KEYWORDS.filter((p) => p.test(text)).length;
      const drainageHits = DRAINAGE_KEYWORDS.filter((p) => p.test(text)).length;

      let type: LocalPageType = "unknown";
      let confidence = 0;

      if (strongHits >= 1 || (planHits >= 3 && adminHits < 2)) {
        type = "floor_plan";
        confidence = Math.min(0.95, 0.5 + strongHits * 0.2 + planHits * 0.05);
      } else if (drainageHits >= 2) {
        type = "drainage_plan";
        confidence = 0.8;
      } else if (sectionHits >= 1 && planHits < 3) {
        type = "section_elevation";
        confidence = 0.7;
      } else if (adminHits >= 2) {
        type = "admin";
        confidence = 0.8;
      } else if (textLen < 50 && !isLandscape) {
        type = "photo_or_blank";
        confidence = 0.5;
      } else if (planHits >= 2) {
        type = "floor_plan";
        confidence = 0.4 + planHits * 0.05;
      }

      // Detect multi-plan landscape pages
      const grondplanLabels = text.match(/grondplan\s*[+\-]?\s*\d+/gi) || [];
      const planLabels =
        text.match(/plan\s+(gelijkvloers|verdieping|kelder)/gi) || [];
      const floorLabelsOnPage = [...grondplanLabels, ...planLabels];

      pages.push({
        pageNumber: i + 1,
        type,
        confidence,
        isLandscape,
        width,
        height,
        textLength: textLen,
        floorLabels: floorLabelsOnPage.map((l) => l.trim()),
        multiPlan: floorLabelsOnPage.length >= 2,
      });
    } catch {
      pages.push({
        pageNumber: i + 1,
        type: "unknown",
        confidence: 0,
        isLandscape: false,
        width: 0,
        height: 0,
        textLength: 0,
        floorLabels: [],
        multiPlan: false,
      });
    }
  }

  return { pages, totalPages };
}

/**
 * Get floor plan page numbers from a PDF using local heuristic classification.
 * Returns the page numbers (1-indexed) of pages identified as floor plans.
 *
 * If no floor plans are detected, returns ALL page numbers as fallback
 * (same behavior as the AI classifier).
 */
export async function getFloorPlanPages(
  pdfBuffer: Buffer,
  maxPages = 40
): Promise<{
  floorPlanPages: number[];
  allClassifications: LocalPageClassification[];
  totalPages: number;
}> {
  const { pages, totalPages } = await classifyPagesLocal(pdfBuffer, maxPages);

  const floorPlanPages = pages
    .filter((p) => p.type === "floor_plan")
    .map((p) => p.pageNumber);

  return {
    floorPlanPages:
      floorPlanPages.length > 0
        ? floorPlanPages
        : pages.map((p) => p.pageNumber), // fallback: all pages
    allClassifications: pages,
    totalPages,
  };
}
