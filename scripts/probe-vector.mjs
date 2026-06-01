import * as mupdf from "mupdf";
import { readFileSync } from "node:fs";
const top = Object.keys(mupdf).filter((k) => /Device|Path|Walk|Draw|Display|Structured/i.test(k));
console.log("mupdf exports (geom/device):", top.join(", "));
const doc = mupdf.Document.openDocument(readFileSync("C:/Users/tieme/Desktop/testing 30_5/25-542077plan.pdf"), "application/pdf");
const page = doc.loadPage(3);
const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(page));
console.log("page methods:", proto.join(", "));
console.log("DrawDevice:", typeof mupdf.DrawDevice, "| DisplayList:", typeof mupdf.DisplayList, "| Device:", typeof mupdf.Device, "| Path:", typeof mupdf.Path);
// try to record draw calls via a JS device if available
try {
  const bounds = page.getBounds();
  console.log("page bounds:", bounds);
} catch (e) { console.log("bounds err", e.message); }
