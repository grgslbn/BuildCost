/**
 * chain-reader.ts — agentic Tier-3 SQM extractor (production port of scripts/chain-reader.mjs).
 *
 * Replicates the human measurement method as a tool-loop: the model views plan pages,
 * ZOOMS IN on dimension chains (crop tool — the API downsamples every image to ~1568px,
 * so zooming is mandatory on A0/A1 sheets), closes chain-segment sums against printed
 * end measures, counts floors from sections, and returns a structured report whose
 * chains are then verified deterministically in code.
 *
 * Validated on the dims-only dev-set (12 dossiers, 2026-08-09): median |Δcost| 4.1%,
 * with an independent verifier pass (blind re-measure of the two largest cat1 parts)
 * as the AUTO gate. See scripts/chain-reader.mjs + scripts/verify-chain.mjs for the
 * research harness and docs/… for the convention handbook distilled from expert
 * berekeningen (terrace/roof/basement/carport/estate/function rules).
 *
 * Runtime: 5–20 min per dossier on claude-opus-5 → ONLY run on the Railway worker
 * (no Vercel 300s limit). Gated behind CHAIN_READER_ENABLED.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  renderPageJpegB64,
  renderCropJpegB64,
  renderThumbJpegB64,
  getPdfPageCount,
} from "@/lib/pdf/render-plans";

export type ChainFloor = {
  label: string;
  page: number;
  cat: "cat1" | "cat2" | "cat3" | "mixed" | "excluded";
  method: "dimension_chains" | "printed_label" | "calibrated_element" | "inferred_from_other_floor";
  shape?: Array<{ w_m: number; d_m: number; sign: number }>;
  width_chain?: number[];
  width_total?: number;
  depth_chain?: number[];
  depth_total?: number;
  area_m2: number;
  cat_split?: { cat1?: number; cat2?: number; cat3?: number };
  notes?: string;
};

export type ChainReport = {
  floors: ChainFloor[];
  cat1_m2: number;
  cat2_m2: number;
  cat3_m2: number;
  floor_count_from_sections: number;
  flags: string[];
  confidence: number;
  notes?: string;
};

export type ChainReaderResult = {
  report: ChainReport | null;
  verificationProblems: string[];
  lowerBound: boolean;
  turns: number;
  toolCalls: number;
  minutes: number;
};

const MODEL = process.env.CHAIN_READER_MODEL || "claude-opus-5";

/** Convention handbook — keep in sync with scripts/chain-reader.mjs (research harness). */
const SYSTEM = `Je bent een expert bouwkundig meetkundige. Je meet de BRUTO vloeroppervlakte per verdieping uit Belgische bouwplannen, zoals een menselijke expert dat doet: door MAATKETENS te lezen, niet door pixels te schatten.

METHODE (volg strikt):
1. ORIËNTATIE: bekijk eerst de paginaminiaturen. Identificeer: grondplannen (per verdieping), snedes (coupe/doorsnede), gevels, inplanting, titelblok (schaal!). Negeer foto's, kadasterkaarten, verslagen. Let op duplicaten (zelfde plan 2x gebonden, of NL+FR versie) — tel die maar één keer.
2. VERDIEPINGEN ENUMEREREN: maak de volledige lijst bouwlagen (kelder(s), gelijkvloers, verdiepingen, dakverdieping). Cross-check het aantal lagen met de snede/gevel. Als er GEEN kelderplan én GEEN snede is: flag "ondergrondse niveaus onzichtbaar — schatting is ondergrens".
3. PER VERDIEPING METEN: zoom met crop in op de maatketens aan de randen van het plan. Lees de buitenste keten (= gebouwenvelop). VERIFIEER: de segmenten van een keten moeten sommeren tot de eindmaat die eronder/ernaast gedrukt staat. Als dat niet klopt heb je verkeerd gelezen — zoom verder in en lees opnieuw. Noteer de ketens in je rapport.
4. OPPERVLAK: decomposeer niet-rechthoekige vormen in rechthoeken (shape-array, sign -1 voor uitsparingen). Maten in mm of cm op het plan → converteer naar meters (Belgische plannen: meestal cm of mm; 450 = 4,50 m).
5. ALS ER GEEN DOORLOPENDE BUITENKETEN IS: benader de verdieping NIET via een geschatte envelop. Werk dan van binnen naar buiten: sommeer de gedrukte BINNENmaten van de ruimtes langs één as + muurdiktes, en SLUIT die som op een gedrukte totaalmaat of op de som van een andere as. Doe dit voor minstens twee assen per verdieping. Identieke verdiepingen (zelfde plattegrond -1/0/+1): meet er één volledig en verifieer de andere met een steekproefmaat i.p.v. het resultaat blind te kopiëren.
5b. ALS KETENS ONLEESBAAR ZIJN (scan te slecht): kalibreer met standaardelementen — parkeerplaats 2,50 m breed, deur 0,90 m, traptrede 0,25 m — en zeg dat in method='calibrated_element'. Dit is een noodgreep, meld lagere confidence.
5c. ZELFCONTROLE vóór report: hermeet de GROOTSTE verdieping één keer onafhankelijk via een andere weg (andere keten, andere as, of som van ruimtes) en vergelijk. Wijkt de tweede meting >8% af van de eerste: onderzoek waarom, en als het niet oplosbaar is → confidence < 0.6 en flag de discrepantie.
5e. DAKVERDIEPINGEN/ZOLDERS onder een schuin dak: de expert telt de BEWOONBARE oppervlakte (vrije hoogte ≥ ±1,5 m), niet de volle vloerplaat. Bepaal het bewoonbare deel via de snede (knikhoogte/dakhelling); zonder snede: neem ±75% van de plaat en flag dat. Afgewerkte dakverdieping → cat1 (bewoonbaar deel). Het deel onder de knik telt NERGENS mee — ook niet als cat2; zet het niet in een cat_split. Alleen een APARTE onafgewerkte bergzolder (eigen niveau, via trap/luik) is cat2.
5f. DOMEINEN MET MEERDERE GEBOUWEN: begin bij het INPLANTINGSPLAN en nummer ALLE gebouwen (hoofdgebouw + elk bijgebouw). Elk gebouw moet in je floors-lijst voorkomen — gemeten, of expliciet geflagd als "niet getekend". Controleer per bijgebouw of er een bovenverdieping is (aparte plattegrond, dakvensters op de gevel, trap op het grondplan). Een vergeten bijgebouw is de grootste foutbron op domeinen.
5d. KELDERS & PARKEERLAGEN krijgen dezelfde ketenstrengheid als woonlagen — dit is een bewezen zwakte. Een parkeerkelder is vaak GROTER dan de bovenbouw-voetafdruk (uitkraging onder tuin/plein). Meet de kelderenvelop uit het kelderplan zelf, nooit gekopieerd van een bovenliggende laag. Cross-check bij parkeerlagen: aantal vakken × ±25 m²/vak (incl. circulatie) moet grosso modo kloppen met je envelopmeting; groot verschil = hermeten.
6. CONVENTIE OPPERVLAKTE (STRIKT): area_m2 van een verdieping = de OMSLOTEN bruto vloeroppervlakte (buitenwerks gemeten, ZONDER open terrassen/balkons — meet tot de gevellijn, niet tot de terrasrand). Elk terras/balkon/dakterras komt als APARTE floor-regel (bv. "terrassen +2"): open/uitkragend → cat3; inpandig (binnen het gebouwvolume) → cat1. Dit spiegelt de CED-tabellen, die terrassen als aparte rijen voeren. Pas deze conventie op ELKE verdieping identiek toe.
6b-cat. CATEGORIEËN (Belgische herbouwwaarde-conventie):
   - cat1 = verwarmd/afgewerkt: woonruimtes, appartementen, kantoren, handelsgelijkvloers, gemeenschappelijke circulatie (traphal/gang/lift), INPANDIGE (in het volume liggende) terrassen.
   - cat2 = niet-verwarmd overdekt: garage, parkeerkelder, kelder/berging, techniek, zolder onafgewerkt. Veranda/kweekkas → cat2-tarief.
   - cat3 = buiten GEBOUWD (een gedragen constructie): vrij uitkragende balkons, dakterrassen, terrassen op een kelderdak.
   - excluded = TERRASSEN OP MAAIVELD/VOLLE GROND (tegels/kasseien in de tuin = buitenaanleg, geen m²), groendak, tuin, zwemvijver, OPEN CARPORTS en open afdaken (aparte post), open hellingbanen.
   - VIDES in een woning: de vloeropening zelf telt NIET mee op de verdieping waar hij zit (meet de werkelijke vloerplaat); trek geen extra af.
6c. HUIDIG GEBRUIK ≠ PLAN: bouwplannen kunnen jaren oud zijn; functies kunnen gewijzigd zijn (opslag → woning, zolder → duplex). Als het dossier verslag-/tekstpagina's bevat (expertiseverslag, beschrijving): lees daar de HUIDIGE functie van elk gebouwdeel en het aantal bouwlagen, en gebruik die voor de cat-toewijzing — het verslag beschrijft de actuele toestand, het plan mogelijk een oude. Wijkt de functie af van het plan: volg het verslag en flag de wijziging. (Getallen/oppervlaktes uit het verslag overnemen mag NIET — alleen functies, gebruik en aantallen lagen.)
7. RAPPORT: pas report aanroepen als elke bouwlaag gemeten of geflagd is. Wees eerlijk in confidence: ketens gelezen en gesloten = hoog; gekalibreerd/gegokt = laag.

BELANGRIJK: op een volledig weergegeven A0/A1-blad zijn maatcijfers ONLEESBAAR (alles wordt naar ~1568px geschaald). Je MOET croppen om te lezen. Werk systematisch: eerst overzicht, dan per verdieping de ketens. Reken zorgvuldig; controleer elke som twee keer.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "view_page",
    description:
      "Bekijk één pagina op volledige grootte (max ~1568px — kleine tekst is dan ONLEESBAAR op grote bladen; gebruik crop om te lezen).",
    input_schema: {
      type: "object",
      properties: { page: { type: "integer" } },
      required: ["page"],
      additionalProperties: false,
    },
  },
  {
    name: "crop",
    description:
      "Zoom in op een deel van een pagina om maatketens, labels en kleine tekst te LEZEN. Coördinaten als fracties van de pagina (x,y = linksboven; w,h = breedte/hoogte). Kleinere regio = meer zoom.",
    input_schema: {
      type: "object",
      properties: {
        page: { type: "integer" },
        x: { type: "number" },
        y: { type: "number" },
        w: { type: "number" },
        h: { type: "number" },
      },
      required: ["page", "x", "y", "w", "h"],
      additionalProperties: false,
    },
  },
  {
    name: "report",
    description:
      "Lever het eindresultaat af. Alleen aanroepen wanneer elke verdieping gemeten of expliciet als onzichtbaar geflagd is.",
    input_schema: {
      type: "object",
      properties: {
        floors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              page: { type: "integer" },
              cat: { type: "string", enum: ["cat1", "cat2", "cat3", "mixed", "excluded"] },
              method: {
                type: "string",
                enum: ["dimension_chains", "printed_label", "calibrated_element", "inferred_from_other_floor"],
              },
              shape: {
                type: "array",
                items: {
                  type: "object",
                  properties: { w_m: { type: "number" }, d_m: { type: "number" }, sign: { type: "integer" } },
                  required: ["w_m", "d_m", "sign"],
                  additionalProperties: false,
                },
              },
              width_chain: { type: "array", items: { type: "number" } },
              width_total: { type: "number" },
              depth_chain: { type: "array", items: { type: "number" } },
              depth_total: { type: "number" },
              area_m2: { type: "number" },
              cat_split: {
                type: "object",
                properties: { cat1: { type: "number" }, cat2: { type: "number" }, cat3: { type: "number" } },
                additionalProperties: false,
              },
              notes: { type: "string" },
            },
            required: ["label", "page", "cat", "method", "area_m2"],
            additionalProperties: false,
          },
        },
        cat1_m2: { type: "number" },
        cat2_m2: { type: "number" },
        cat3_m2: { type: "number" },
        floor_count_from_sections: { type: "integer" },
        flags: { type: "array", items: { type: "string" } },
        confidence: { type: "number" },
        notes: { type: "string" },
      },
      required: ["floors", "cat1_m2", "cat2_m2", "cat3_m2", "floor_count_from_sections", "flags", "confidence"],
      additionalProperties: false,
    },
  },
];

const img = (b64: string): Anthropic.ImageBlockParam => ({
  type: "image",
  source: { type: "base64", media_type: "image/jpeg", data: b64 },
});

function setCacheBreakpoint(messages: Anthropic.MessageParam[]) {
  for (const m of messages)
    if (Array.isArray(m.content))
      for (const c of m.content) delete (c as { cache_control?: unknown }).cache_control;
  const last = messages[messages.length - 1];
  if (Array.isArray(last.content) && last.content.length) {
    (last.content[last.content.length - 1] as { cache_control?: unknown }).cache_control = {
      type: "ephemeral",
    };
  }
}

/** Deterministic verification: chain sums must close on printed end measures. */
export function verifyChainReport(report: ChainReport): string[] {
  const problems: string[] = [];
  for (const f of report.floors || []) {
    const axes: Array<[number[] | undefined, number | undefined, string]> = [
      [f.width_chain, f.width_total, "breedte"],
      [f.depth_chain, f.depth_total, "diepte"],
    ];
    for (const [chain, total, lbl] of axes) {
      if (chain?.length && total) {
        const s = chain.reduce((a, b) => a + b, 0);
        if (Math.abs(s - total) / total > 0.03)
          problems.push(`${f.label}: ${lbl}-keten som ${s.toFixed(2)} ≠ eindmaat ${total}`);
      }
    }
    if (f.shape?.length) {
      const sa = f.shape.reduce((a, r) => a + r.sign * r.w_m * r.d_m, 0);
      if (f.area_m2 > 0 && Math.abs(sa - f.area_m2) / f.area_m2 > 0.05)
        problems.push(`${f.label}: shape-som ${sa.toFixed(1)} ≠ area ${f.area_m2}`);
    }
  }
  const sums = { cat1: 0, cat2: 0, cat3: 0 };
  for (const f of report.floors || []) {
    if (f.cat === "mixed" && f.cat_split) {
      sums.cat1 += f.cat_split.cat1 || 0;
      sums.cat2 += f.cat_split.cat2 || 0;
      sums.cat3 += f.cat_split.cat3 || 0;
    } else if (f.cat === "cat1" || f.cat === "cat2" || f.cat === "cat3") {
      sums[f.cat] += f.area_m2;
    }
  }
  for (const c of ["cat1", "cat2", "cat3"] as const) {
    const rep = report[`${c}_m2`] || 0;
    if (rep > 0 && Math.abs(sums[c] - rep) / rep > 0.05)
      problems.push(`${c}: verdiepingssom ${sums[c].toFixed(0)} ≠ gerapporteerd ${rep}`);
  }
  return problems;
}

/**
 * Run the agentic chain-reader over a plan PDF.
 * `blockedPages` (berekening pages when present) are never shown to the model.
 */
export async function runChainReader(
  pdfBuffer: Buffer,
  opts: {
    blockedPages?: number[];
    maxTurns?: number;
    dossierLabel?: string;
    apiKey?: string;
  } = {},
): Promise<ChainReaderResult> {
  const t0 = Date.now();
  const client = new Anthropic({ apiKey: opts.apiKey || process.env.ANTHROPIC_API_KEY });
  const blocked = new Set(opts.blockedPages || []);
  const maxTurns = opts.maxTurns ?? 50;
  const nPages = await getPdfPageCount(pdfBuffer);
  const visible = Array.from({ length: nPages }, (_, i) => i).filter((i) => !blocked.has(i));

  const MAX_THUMBS = 42;
  const thumbPages = visible.slice(0, MAX_THUMBS);
  const content: Anthropic.ContentBlockParam[] = [
    {
      type: "text",
      text: `Dossier: ${opts.dossierLabel || "plan"}. ${nPages} pagina's; jij krijgt ${visible.length} pagina's. Hieronder miniaturen van pagina's [${thumbPages.join(", ")}]${visible.length > MAX_THUMBS ? ` (rest via view_page: ${visible.slice(MAX_THUMBS).join(", ")})` : ""}. Meet de bruto vloeroppervlakte per verdieping en rapporteer cat1/cat2/cat3.`,
    },
  ];
  for (const i of thumbPages) {
    content.push({ type: "text", text: `p${i}:` });
    content.push(img(await renderThumbJpegB64(pdfBuffer, i)));
  }

  const messages: Anthropic.MessageParam[] = [{ role: "user", content }];
  let report: ChainReport | null = null;
  let turns = 0;
  let toolCalls = 0;

  while (turns < maxTurns && !report) {
    turns++;
    setCacheBreakpoint(messages);
    let msg: Anthropic.Message | undefined;
    for (let a = 0; a < 5; a++) {
      try {
        const stream = client.messages.stream({
          model: MODEL,
          max_tokens: 32000,
          system: SYSTEM,
          tools: TOOLS,
          messages,
        });
        msg = await stream.finalMessage();
        break;
      } catch (e) {
        const st = (e as { status?: number })?.status || 0;
        if (st === 429 || st >= 500) {
          await new Promise((r) => setTimeout(r, 8000 * (a + 1)));
          continue;
        }
        throw e;
      }
    }
    if (!msg) throw new Error("chain-reader: API bleef falen");
    if (msg.stop_reason === "refusal") throw new Error("chain-reader: refusal");

    const toolUses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    messages.push({ role: "assistant", content: msg.content });
    if (!toolUses.length) break;

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      toolCalls++;
      try {
        if (tu.name === "report") {
          report = tu.input as ChainReport;
          results.push({ type: "tool_result", tool_use_id: tu.id, content: "rapport ontvangen" });
        } else if (tu.name === "view_page") {
          const i = (tu.input as { page: number }).page;
          if (blocked.has(i) || i < 0 || i >= nPages) {
            results.push({ type: "tool_result", tool_use_id: tu.id, content: "pagina niet beschikbaar", is_error: true });
            continue;
          }
          results.push({ type: "tool_result", tool_use_id: tu.id, content: [img(await renderPageJpegB64(pdfBuffer, i))] });
        } else if (tu.name === "crop") {
          const { page, x, y, w, h } = tu.input as { page: number; x: number; y: number; w: number; h: number };
          if (blocked.has(page) || page < 0 || page >= nPages) {
            results.push({ type: "tool_result", tool_use_id: tu.id, content: "pagina niet beschikbaar", is_error: true });
            continue;
          }
          results.push({ type: "tool_result", tool_use_id: tu.id, content: [img(await renderCropJpegB64(pdfBuffer, page, x, y, w, h))] });
        } else {
          results.push({ type: "tool_result", tool_use_id: tu.id, content: "onbekende tool", is_error: true });
        }
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: tu.id, content: String((e as Error).message || e).slice(0, 200), is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }

  const verificationProblems = report ? verifyChainReport(report) : [];
  const lowerBound = (report?.flags || []).some((x) => /ondergrens|onzichtbaar/i.test(x));
  return {
    report,
    verificationProblems,
    lowerBound,
    turns,
    toolCalls,
    minutes: +((Date.now() - t0) / 60000).toFixed(1),
  };
}
