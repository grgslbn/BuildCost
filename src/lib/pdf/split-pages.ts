import { PDFDocument } from "pdf-lib";

export type SplitPage = {
  pageNumber: number;
  base64: string;
};

export type SplitResult = {
  pages: SplitPage[];
  totalPageCount: number;
};

/**
 * Splits a PDF buffer into individual single-page PDFs (base64-encoded).
 * maxPages caps how many pages are processed to stay within memory/time limits.
 */
export async function splitPdfPages(
  pdfBuffer: Buffer,
  maxPages = 40
): Promise<SplitResult> {
  const srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const totalPageCount = srcDoc.getPageCount();
  const pageLimit = Math.min(totalPageCount, maxPages);

  const pages: SplitPage[] = [];

  for (let i = 0; i < pageLimit; i++) {
    const singleDoc = await PDFDocument.create();
    const [copied] = await singleDoc.copyPages(srcDoc, [i]);
    singleDoc.addPage(copied);
    const bytes = await singleDoc.save();
    pages.push({
      pageNumber: i + 1,
      base64: Buffer.from(bytes).toString("base64"),
    });
  }

  return { pages, totalPageCount };
}
