import { readFileSync } from 'fs';
import { join } from 'path';

let mupdf, sharp;

async function ensureDeps() {
  if (!mupdf) mupdf = await import('mupdf');
  if (!sharp) sharp = (await import('sharp')).default;
}

export async function renderPage(pdfPath, pageNum, opts = {}) {
  await ensureDeps();
  const { maxWidth = 5000, dpi = 300 } = opts;

  const pdfData = readFileSync(pdfPath);
  const doc = mupdf.Document.openDocument(pdfData, 'application/pdf');
  const page = doc.loadPage(pageNum - 1);
  const bounds = page.getBounds();
  const pageW = bounds[2] - bounds[0];
  const pageH = bounds[3] - bounds[1];

  const scale = Math.min(maxWidth / pageW, dpi / 72);
  const pixmap = page.toPixmap(
    mupdf.Matrix.scale(scale, scale),
    mupdf.ColorSpace.DeviceRGB,
    false, true
  );
  const png = Buffer.from(pixmap.asPNG());
  const width = pixmap.getWidth();
  const height = pixmap.getHeight();

  return { png, width, height, pageW, pageH, scale };
}

export async function cropImage(pngBuffer, fullW, fullH, crop) {
  await ensureDeps();
  const { left, top, width, height } = crop;
  const l = Math.round(left * fullW);
  const t = Math.round(top * fullH);
  const w = Math.min(Math.round(width * fullW), fullW - l);
  const h = Math.min(Math.round(height * fullH), fullH - t);

  const cropped = await sharp(pngBuffer)
    .extract({ left: l, top: t, width: w, height: h })
    .png()
    .toBuffer();

  return { png: cropped, width: w, height: h };
}

export async function renderPlanImages(pdfPath, planPages, opts = {}) {
  await ensureDeps();
  const { maxWidth = 5000, dpi = 300 } = opts;
  const images = [];

  const pdfData = readFileSync(pdfPath);
  const doc = mupdf.Document.openDocument(pdfData, 'application/pdf');

  for (const pageInfo of planPages) {
    const page = doc.loadPage(pageInfo.pageNum - 1);
    const bounds = page.getBounds();
    const pageW = bounds[2] - bounds[0];
    const pageH = bounds[3] - bounds[1];

    const scale = Math.min(maxWidth / pageW, dpi / 72);
    const pixmap = page.toPixmap(
      mupdf.Matrix.scale(scale, scale),
      mupdf.ColorSpace.DeviceRGB,
      false, true
    );
    const fullPng = Buffer.from(pixmap.asPNG());
    const fullW = pixmap.getWidth();
    const fullH = pixmap.getHeight();

    if (pageInfo.isLandscape && pageInfo.multiPlan) {
      // Multi-plan landscape: crop into individual plans
      // Heuristic: if 2 GRONDPLAN labels, split L/R
      // If 3+ labels, split into quadrants
      const labels = pageInfo.floorLabels || [];
      const crops = detectCropRegions(labels, pageInfo);

      for (const crop of crops) {
        const l = Math.round(crop.left * fullW);
        const t = Math.round(crop.top * fullH);
        const w = Math.min(Math.round(crop.width * fullW), fullW - l);
        const h = Math.min(Math.round(crop.height * fullH), fullH - t);

        const cropped = await sharp(fullPng)
          .extract({ left: l, top: t, width: w, height: h })
          .png()
          .toBuffer();

        images.push({
          name: `p${pageInfo.pageNum}-${crop.label}`,
          pageNum: pageInfo.pageNum,
          png: cropped,
          width: w,
          height: h,
          label: crop.label,
          floorLabels: crop.floorLabels || []
        });
      }
    } else {
      // Single plan page — use as-is (optionally trim title block)
      images.push({
        name: `p${pageInfo.pageNum}`,
        pageNum: pageInfo.pageNum,
        png: fullPng,
        width: fullW,
        height: fullH,
        label: `page-${pageInfo.pageNum}`,
        floorLabels: pageInfo.floorLabels || []
      });
    }
  }

  return images;
}

function detectCropRegions(labels, pageInfo) {
  // Default: for landscape pages with multiple plans, use quadrant splitting
  // Most Belgian plan sheets: 2-3 plans on a landscape A1/A0 sheet
  const numLabels = labels.length;

  if (numLabels >= 3) {
    // 3+ plans: assume top-left, bottom-left, right layout (common for GV, V+1, V+2)
    return [
      { left: 0, top: 0, width: 0.52, height: 0.50, label: 'top-left', floorLabels: [labels[0]] },
      { left: 0, top: 0.48, width: 0.52, height: 0.52, label: 'bottom-left', floorLabels: [labels[1]] },
      { left: 0.48, top: 0, width: 0.52, height: 0.55, label: 'right', floorLabels: labels.slice(2) },
    ];
  } else if (numLabels === 2) {
    // 2 plans: left/right split
    return [
      { left: 0, top: 0, width: 0.52, height: 1.0, label: 'left', floorLabels: [labels[0]] },
      { left: 0.48, top: 0, width: 0.52, height: 1.0, label: 'right', floorLabels: [labels[1]] },
    ];
  } else {
    // Single plan on landscape — use full page
    return [
      { left: 0, top: 0, width: 1.0, height: 1.0, label: 'full', floorLabels: labels },
    ];
  }
}
