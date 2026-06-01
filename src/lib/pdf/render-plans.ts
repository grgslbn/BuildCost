/**
 * Renders PDF pages to high-resolution PNG images using mupdf + sharp.
 * Ported from WS1 plan-renderer.mjs — includes landscape multi-plan cropping.
 */

import type { LocalPageClassification } from "./classify-pages-local";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mupdfMod: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sharpMod: any = null;

async function ensureDeps() {
  if (!mupdfMod) mupdfMod = await import("mupdf");
  if (!sharpMod) sharpMod = (await import("sharp")).default;
}

export type RenderedImage = {
  name: string;
  pageNumber: number;
  png: Buffer;
  width: number;
  height: number;
  floorLabels: string[];
};

type CropRegion = {
  left: number;
  top: number;
  width: number;
  height: number;
  label: string;
  floorLabels: string[];
};

function detectCropRegions(
  labels: string[],
  _pageInfo: LocalPageClassification,
  aspect = 1.4
): CropRegion[] {
  const n = labels.length;
  if (n <= 1) {
    return [{ left: 0, top: 0, width: 1.0, height: 1.0, label: "full", floorLabels: labels }];
  }

  // Architect sheets usually place plans in a single horizontal ROW (wide page)
  // or a single vertical COLUMN. Crop ONE plan per image so each gets the full
  // ~1568px the vision model downsamples to. Overlap avoids cutting a plan in two.
  // (Anthropic downscales every image to ≤1568px on the long edge, so splitting
  //  N plans into N images is what makes dimension chains legible.)
  const OVERLAP = 0.10;
  const wide = aspect >= 1.25;

  if (wide) {
    // N vertical strips across the width
    const w = 1 / n + OVERLAP;
    return labels.map((lab, i) => {
      const left = Math.max(0, i / n - OVERLAP / 2);
      return { left, top: 0, width: Math.min(w, 1 - left), height: 1.0, label: `col${i}`, floorLabels: [lab] };
    });
  }
  // Tall/square page: N horizontal strips down the height
  const h = 1 / n + OVERLAP;
  return labels.map((lab, i) => {
    const top = Math.max(0, i / n - OVERLAP / 2);
    return { left: 0, top, width: 1.0, height: Math.min(h, 1 - top), label: `row${i}`, floorLabels: [lab] };
  });
}

/**
 * Render PDF pages to high-res PNG images with landscape multi-plan cropping.
 * When page classifications are provided, landscape pages with multiple plans
 * are cropped into separate images (matching WS1 pipeline).
 */
export async function renderPdfPagesToImages(
  pdfBuffer: Buffer,
  pageClassifications: LocalPageClassification[],
  opts: { maxWidth?: number; dpi?: number } = {}
): Promise<RenderedImage[]> {
  await ensureDeps();
  const mupdf = mupdfMod!;
  const sharp = sharpMod!;
  const { maxWidth = 5000, dpi = 300 } = opts;

  const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf");
  const images: RenderedImage[] = [];

  for (const pageInfo of pageClassifications) {
    const page = doc.loadPage(pageInfo.pageNumber - 1);
    const bounds = page.getBounds();
    const pageW = bounds[2] - bounds[0];
    const pageH = bounds[3] - bounds[1];
    const aspect = pageH > 0 ? pageW / pageH : 1.4;

    const scale = Math.min(maxWidth / pageW, dpi / 72);
    const pixmap = page.toPixmap(
      mupdf.Matrix.scale(scale, scale),
      mupdf.ColorSpace.DeviceRGB,
      false,
      true
    );

    const fullPng = Buffer.from(pixmap.asPNG());
    const fullW = pixmap.getWidth();
    const fullH = pixmap.getHeight();

    if (pageInfo.isLandscape && pageInfo.multiPlan) {
      const crops = detectCropRegions(pageInfo.floorLabels, pageInfo, aspect);

      for (const crop of crops) {
        const l = Math.round(crop.left * fullW);
        const t = Math.round(crop.top * fullH);
        const w = Math.min(Math.round(crop.width * fullW), fullW - l);
        const h = Math.min(Math.round(crop.height * fullH), fullH - t);

        const cropped: Buffer = await sharp(fullPng)
          .extract({ left: l, top: t, width: w, height: h })
          .png()
          .toBuffer();

        images.push({
          name: `p${pageInfo.pageNumber}-${crop.label}`,
          pageNumber: pageInfo.pageNumber,
          png: cropped,
          width: w,
          height: h,
          floorLabels: crop.floorLabels,
        });
      }
    } else {
      images.push({
        name: `p${pageInfo.pageNumber}`,
        pageNumber: pageInfo.pageNumber,
        png: fullPng,
        width: fullW,
        height: fullH,
        floorLabels: pageInfo.floorLabels,
      });
    }
  }

  return images;
}

/**
 * Render specific 1-indexed pages to base64 PNGs (≤ ~3.8 MB each, downscaled if needed).
 * Used by the SQM router's area-table route to feed table pages to the vision model.
 */
export async function renderSpecificPagesToBase64(
  pdfBuffer: Buffer,
  pageNumbers1Indexed: number[],
  dpi = 170,
): Promise<string[]> {
  await ensureDeps();
  const mupdf = mupdfMod!;
  const sharp = sharpMod!;
  const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf");
  const total = doc.countPages();
  const out: string[] = [];
  for (const p of pageNumbers1Indexed) {
    if (p < 1 || p > total) continue;
    try {
      const pix = doc
        .loadPage(p - 1)
        .toPixmap(mupdf.Matrix.scale(dpi / 72, dpi / 72), mupdf.ColorSpace.DeviceRGB, false, true);
      let png: Buffer = Buffer.from(pix.asPNG());
      let w = pix.getWidth();
      while (png.length > 3_600_000 && w > 1400) {
        w = Math.floor(w * 0.82);
        png = await sharp(Buffer.from(pix.asPNG())).resize({ width: w }).png().toBuffer();
      }
      if (png.length <= 3_900_000) out.push(png.toString("base64"));
    } catch {
      /* skip unrenderable page */
    }
  }
  return out;
}

/**
 * Render the given 1-indexed pages and split each into an overlapping NxN grid of
 * tiles (default 3×3). Anthropic downsamples every image to ~1568px on the long edge,
 * so small printed m² labels on a full A0/A1 sheet are lost; tiling keeps each region
 * near native resolution so the labels survive. Validated 2026-06-01: with the correct
 * floor-plan pages tiled, vision reads per-apartment labels to ~±7% of net area.
 * Tiles are capped (maxTiles) to keep a single vision call sane.
 */
export async function renderPlanTilesToBase64(
  pdfBuffer: Buffer,
  pageNumbers1Indexed: number[],
  opts: { dpi?: number; grid?: number; overlap?: number; maxTiles?: number } = {},
): Promise<string[]> {
  await ensureDeps();
  const mupdf = mupdfMod!;
  const sharp = sharpMod!;
  const { dpi = 200, grid = 3, overlap = 0.08, maxTiles = 18 } = opts;
  const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf");
  const total = doc.countPages();
  const out: string[] = [];
  for (const p of pageNumbers1Indexed) {
    if (out.length >= maxTiles) break;
    if (p < 1 || p > total) continue;
    let full: Buffer;
    let W: number;
    let H: number;
    try {
      const pix = doc
        .loadPage(p - 1)
        .toPixmap(mupdf.Matrix.scale(dpi / 72, dpi / 72), mupdf.ColorSpace.DeviceRGB, false, true);
      full = Buffer.from(pix.asPNG());
      W = pix.getWidth();
      H = pix.getHeight();
    } catch {
      continue;
    }
    if (W < 600 || H < 500) {
      // small page: send whole
      if (full.length <= 3_900_000) out.push(full.toString("base64"));
      continue;
    }
    for (let gy = 0; gy < grid && out.length < maxTiles; gy++) {
      for (let gx = 0; gx < grid && out.length < maxTiles; gx++) {
        const left = Math.max(0, Math.floor((gx / grid - overlap) * W));
        const top = Math.max(0, Math.floor((gy / grid - overlap) * H));
        const w = Math.min(W - left, Math.ceil((1 / grid + 2 * overlap) * W));
        const h = Math.min(H - top, Math.ceil((1 / grid + 2 * overlap) * H));
        if (w < 50 || h < 50) continue;
        try {
          let png: Buffer = await sharp(full).extract({ left, top, width: w, height: h }).png().toBuffer();
          if (Math.max(w, h) > 1600) {
            png = await sharp(png)
              .resize(w >= h ? { width: 1568 } : { height: 1568 })
              .png()
              .toBuffer();
          }
          if (png.length <= 3_700_000) out.push(png.toString("base64"));
        } catch {
          /* skip tile */
        }
      }
    }
  }
  return out;
}

/**
 * Tile a single raster image (a JPEG/PNG upload) into an overlapping NxN grid, same
 * idea as renderPlanTilesToBase64 but for an already-rastered image instead of a PDF
 * page. Makes labels/dimensions on a photographed or exported plan legible past the
 * ~1568px API downsample. Returns [wholeImage, ...tiles] so a small/simple image still
 * works; tiles are skipped when the source is already small.
 */
export async function tileImageToBase64(
  imageBuffer: Buffer,
  opts: { grid?: number; overlap?: number; maxTiles?: number } = {},
): Promise<string[]> {
  await ensureDeps();
  const sharp = sharpMod!;
  const { grid = 3, overlap = 0.08, maxTiles = 10 } = opts;
  let meta: { width?: number; height?: number };
  try {
    meta = await sharp(imageBuffer).metadata();
  } catch {
    return [imageBuffer.toString("base64")];
  }
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  // Small image (already near/under the downsample limit): no benefit to tiling.
  if (W < 2200 && H < 2200) return [imageBuffer.toString("base64")];

  const out: string[] = [];
  // include a downscaled whole-image overview first (context for the model)
  try {
    const overview = await sharp(imageBuffer).resize({ width: 1568, withoutEnlargement: true }).png().toBuffer();
    if (overview.length <= 3_900_000) out.push(overview.toString("base64"));
  } catch {
    /* skip overview */
  }
  for (let gy = 0; gy < grid && out.length < maxTiles; gy++) {
    for (let gx = 0; gx < grid && out.length < maxTiles; gx++) {
      const left = Math.max(0, Math.floor((gx / grid - overlap) * W));
      const top = Math.max(0, Math.floor((gy / grid - overlap) * H));
      const w = Math.min(W - left, Math.ceil((1 / grid + 2 * overlap) * W));
      const h = Math.min(H - top, Math.ceil((1 / grid + 2 * overlap) * H));
      if (w < 50 || h < 50) continue;
      try {
        let png: Buffer = await sharp(imageBuffer).extract({ left, top, width: w, height: h }).png().toBuffer();
        if (Math.max(w, h) > 1600) {
          png = await sharp(png).resize(w >= h ? { width: 1568 } : { height: 1568 }).png().toBuffer();
        }
        if (png.length <= 3_700_000) out.push(png.toString("base64"));
      } catch {
        /* skip tile */
      }
    }
  }
  return out.length ? out : [imageBuffer.toString("base64")];
}

/**
 * Extract concatenated text from all pages (form-feed separated), for the SQM router
 * to detect a structured area table.
 */
export async function getPdfText(pdfBuffer: Buffer): Promise<string> {
  await ensureDeps();
  const mupdf = mupdfMod!;
  const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf");
  const parts: string[] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    try {
      parts.push(doc.loadPage(i).toStructuredText("preserve-whitespace").asText());
    } catch {
      parts.push("");
    }
  }
  return parts.join("\f");
}

/**
 * Get total page count from a PDF buffer without rendering.
 */
export async function getPdfPageCount(pdfBuffer: Buffer): Promise<number> {
  await ensureDeps();
  const doc = mupdfMod!.Document.openDocument(pdfBuffer, "application/pdf");
  return doc.countPages();
}
