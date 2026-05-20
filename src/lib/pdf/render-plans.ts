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
  _pageInfo: LocalPageClassification
): CropRegion[] {
  const numLabels = labels.length;

  if (numLabels >= 3) {
    return [
      { left: 0, top: 0, width: 0.52, height: 0.50, label: "top-left", floorLabels: [labels[0]] },
      { left: 0, top: 0.48, width: 0.52, height: 0.52, label: "bottom-left", floorLabels: [labels[1]] },
      { left: 0.48, top: 0, width: 0.52, height: 0.55, label: "right", floorLabels: labels.slice(2) },
    ];
  } else if (numLabels === 2) {
    return [
      { left: 0, top: 0, width: 0.52, height: 1.0, label: "left", floorLabels: [labels[0]] },
      { left: 0.48, top: 0, width: 0.52, height: 1.0, label: "right", floorLabels: [labels[1]] },
    ];
  } else {
    return [
      { left: 0, top: 0, width: 1.0, height: 1.0, label: "full", floorLabels: labels },
    ];
  }
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
      const crops = detectCropRegions(pageInfo.floorLabels, pageInfo);

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
 * Get total page count from a PDF buffer without rendering.
 */
export async function getPdfPageCount(pdfBuffer: Buffer): Promise<number> {
  await ensureDeps();
  const doc = mupdfMod!.Document.openDocument(pdfBuffer, "application/pdf");
  return doc.countPages();
}
