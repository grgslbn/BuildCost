import * as mupdf from "mupdf";
import { readFileSync } from "node:fs";

const path = process.argv[2];
const buf = readFileSync(path);
const doc = mupdf.Document.openDocument(buf, "application/pdf");
const n = doc.countPages();
console.log("pages:", n);
// Dump structured text for each page; find the table page
for (let i = 0; i < n; i++) {
  const page = doc.loadPage(i);
  const st = page.toStructuredText("preserve-whitespace");
  const json = JSON.parse(st.asJSON());
  const blocks = json.blocks || [];
  // Reconstruct lines: each block has lines with bbox + text
  let text = "";
  for (const b of blocks) {
    for (const line of (b.lines || [])) {
      const lineText = (line.text != null) ? line.text
        : (line.spans || []).map((s) => (s.text ?? (s.chars||[]).map(c=>c.c).join(""))).join("");
      text += lineText + "\n";
    }
  }
  if (/Omschrijving|Niveau|nieuwbouwwaarde/i.test(text)) {
    console.log(`\n===== PAGE ${i} (table) =====`);
    // Print first 30 lines with their y-position for inspection
    let count = 0;
    for (const b of blocks) {
      for (const line of (b.lines || [])) {
        const lineText = (line.text != null) ? line.text
          : (line.spans || []).map((s) => (s.text ?? (s.chars||[]).map(c=>c.c).join(""))).join("");
        const bbox = line.bbox || {};
        console.log(`y=${Math.round(bbox.y ?? 0)} x=${Math.round(bbox.x ?? 0)} | ${lineText}`);
        if (++count > 40) break;
      }
      if (count > 40) break;
    }
    break;
  }
}
