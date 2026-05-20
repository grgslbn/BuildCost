/**
 * Renders PDF pages to high-resolution PNG images using mupdf + sharp.
 * Identical to WS1 plan-renderer.mjs but works with Buffers (no filesystem).
 */

// Dynamic imports — mupdf and sharp are native modules
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
};

/**
 * Render specific PDF pages to high-res PNG images.
 * Matches WS1 pipeline: 300 DPI, max 5000px width.
 */
export async function renderPdfPagesToImages(
  pdfBuffer: Buffer,
  pageNumbers: number[],
  opts: { maxWidth?: number; dpi?: number } = {}
): Promise<RenderedImage[]> {
  await ensureDeps();
  const mupdf = mupdfMod!;
  const { maxWidth = 5000, dpi = 300 } = opts;

  const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf");
  const images: RenderedImage[] = [];

  for (const pageNum of pageNumbers) {
    const page = doc.loadPage(pageNum - 1); // 0-indexed
    const bounds = page.getBounds();
    const pageW = bounds[2] - bounds[0];

    const scale = Math.min(maxWidth / pageW, dpi / 72);
    const pixmap = page.toPixmap(
      mupdf.Matrix.scale(scale, scale),
      mupdf.ColorSpace.DeviceRGB,
      false,
      true
    );

    const png = Buffer.from(pixmap.asPNG());
    const width = pixmap.getWidth();
    const height = pixmap.getHeight();

    images.push({
      name: `p${pageNum}`,
      pageNumber: pageNum,
      png,
      width,
      height,
    });
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
