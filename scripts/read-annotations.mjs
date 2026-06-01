/**
 * Read EXACT annotation text from Gebouw A floor plans.
 * Sends only pages 3 and 5 (UV/4/D and UV/5/D) with a focused prompt.
 */
import { readFile, writeFile } from "fs/promises";
import { PDFDocument } from "pdf-lib";
import Anthropic from "@anthropic-ai/sdk";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env.local");
try {
  const envContent = await readFile(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
} catch {}

const pdfPath = "C:\\Users\\tieme\\Desktop\\testing v3\\25-54679500033VerzamelPDF_20260426_2307.pdf";
const apiKey = process.env.BUILDCOST_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY;

console.log("Loading PDF...");
const pdfBuffer = await readFile(pdfPath);
const srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });

// Pages 3 and 5 (0-indexed: 2 and 4) = UV/4/D (Nivo+01, +02) and UV/5/D (Nivo+02, +03)
const pagesToRead = [2, 4]; // 0-indexed
const contentBlocks = [{
  type: "text",
  text: `Look at these two architectural plan pages for Gebouw A (Building A).

Each page shows 2 floor plans side by side at the bottom. For each floor plan, there are ANNOTATION BOXES near the apartment labels (e.g., "App. A.1.f1", "App. A.2.01" etc.).

YOUR TASK: For each apartment annotation box on these plans, transcribe the EXACT TEXT you see. Include:
- The apartment label (e.g., "App. A.1.f1")
- ALL numbers/areas shown (Bruto, Netto, Terras, anything else)
- ANY other text in the annotation box

Also transcribe any other area annotations visible on the plans (circulation areas, common areas, BVO labels, etc.).

Be EXTREMELY precise. Copy the text CHARACTER BY CHARACTER. If you can't read a number clearly, write "[unclear: looks like XX]".

Return a structured list, organized by page and floor level.`
}];

for (const pageIdx of pagesToRead) {
  const singleDoc = await PDFDocument.create();
  const [copied] = await singleDoc.copyPages(srcDoc, [pageIdx]);
  singleDoc.addPage(copied);
  const bytes = await singleDoc.save();
  const base64 = Buffer.from(bytes).toString("base64");

  contentBlocks.push(
    { type: "text", text: `\n--- Page ${pageIdx + 1} (PDF page ${pageIdx + 1}) ---` },
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
  );
}

const client = new Anthropic({ apiKey });
console.log("Calling Claude to read annotations...\n");

const response = await client.messages.stream({
  model: "claude-sonnet-4-6",
  max_tokens: 8192,
  messages: [{ role: "user", content: contentBlocks }],
}).finalMessage();

const text = response.content.find(b => b.type === "text")?.text ?? "";
console.log(text);

await writeFile(resolve(__dirname, "annotation-readout.txt"), text, "utf-8");
console.log("\n\nSaved to scripts/annotation-readout.txt");
