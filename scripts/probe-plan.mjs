import * as mupdf from "mupdf";
import sharp from "sharp";
import { readFileSync } from "node:fs";
const FILE = process.argv[2];
const doc = mupdf.Document.openDocument(readFileSync(FILE), "application/pdf");
console.log("mupdf page count:", doc.countPages());
// render page sizes for first 6 pages
for (let i = 0; i < Math.min(8, doc.countPages()); i++) {
  const b = doc.loadPage(i).getBounds();
  console.log(`  p${i}: ${Math.round(b[2]-b[0])}x${Math.round(b[3]-b[1])} pt`);
}
