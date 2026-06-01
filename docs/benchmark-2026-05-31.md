# Benchmark 2026-05-31 — 8 testdossiers (Desktop/testing 30_5)

Volledige test/benchmark van 8 VerzamelPDF-dossiers (plan + expert-berekening) + diagnose
van SQM en het prijsmodel. Data: `scripts/bench-experts.json`, `scripts/bench-qqp.json`.

## Expert ground truth (uit de berekeningen, vision-geëxtraheerd)
| Dossier | type | totaal | woon m² | **woon €/m²** | niet m² | terras m² |
|---|---|---|---|---|---|---|
| 25-542042 | winkel | €1.818.000 | 537 | €2.957 | 115 | 0 |
| 25-547561 | app | €1.981.150 | 785 | €2.068 | 200 | 0 |
| 25-547560 | app | €7.284.362 | 2.661 | €2.134 | 1.160 | 40 |
| 25-546287 (Liedekerke) | app | €4.999.378 | 1.501 | €2.135 | 45 | 492 |
| 26-550471 | app | €5.003.086 | 1.879 | €2.310 | 392 | 66 |
| 25-547563 (groot) | app | €57.065.550 | 14.194 | €2.495 | 11.863 | 1.013 |
| 26-550795 | app | €4.324.302 | 1.151 | €2.630 | 662 | 35 |
| 25-542077 (Die Prince) | app | €6.453.096 | 1.876 | €2.880 | 444 | 271 |

Appartement woon €/m²: **€2.068–€2.880**, mediaan ~€2.380. Allemaal binnen PlanBase-band [€1.600–€2.900].

## Bevinding 1 — Prijsmodel is goed gecentreerd, QQP voegt weinig toe
- QQP-wsum correleert **nauwelijks** met expert woon €/m² (Die Prince €2.880 → wsum 0,03; 547563 €2.495 → wsum 0,19).
- Gecalibreerd model MAE = **€259/m²** ≈ constante MAE €278/m². → QQP→F heeft minimale voorspelkracht.
- Woon €/m² is uit plan-QQP's nauwelijks voorspelbaar; de ±18%-variatie zit in materialen/afwerking die niet op plannen staan.
- **Live intercept 1,2824 → baseline €2.357 ≈ appartement-mediaan €2.380.** Correct gecentreerd op 7 echte ankers. Cap €2.900 past (Die Prince €2.880).
- → **Geen prijswijziging nodig.** Over-engineeren van QQP-gewichten helpt niet.

## Bevinding 2 — SQM (bruto-opp) is de echte bottleneck
- Het model kan getallen lezen (bij genoeg resolutie) maar kan de **maatketens niet betrouwbaar tot een bruto-footprint** verwerken (welke maat is buitenwerks? cm/mm? diepte-keten? gestapelde setbacks?). Het valt terug op netto Opp-labels → **35-54% onderschatting** (netto vs bruto+circulatie).
- Resolutie is nodig maar niet voldoende: op 200 DPI leest het de getallen, maar de *interpretatie* faalt nog.

## Gemene deler — plan-lezen / pagina-selectie is de gate
Zowel SQM (bruto-opp) als QQP (afwerking) hangen af van het **vinden + lezen van de juiste plattegronden**.
Bewijs: met juiste pagina's vond QQP Die Prince's luxe wél (F=1,50); met densiteit-heuristiek koos het verkeerde pagina's (wsum 0,03). De prijswiskunde + F-mapping zijn prima gegeven goede input.

→ **Verbeterhefboom = `classify-pages.ts` (juiste floor-plan pagina's) + `render-plans.ts` (per-plattegrond crop @hoge DPI) + bruto-meting.** Niet de prijs, niet de F-gewichten.

## UPDATE 2026-05-31 — selectie-mappen + eenheidsprijzen-overzicht
Bron: `M²Value/field/SELECTION/` (curated per gebouwtype) + `selectie building/Eenheidsprijzen_Berekeningsnota_Overzicht.pdf`
(245 CED-meetpunten + 196 Connect). Aanbevolen basisprijzen (gevalideerd):
| Categorie | Min | **Basis P50** | Max |
|---|---|---|---|
| CAT1 woon | €1.600 | **€2.150** | €2.900 |
| CAT2 kelder/garage | €900 | **€1.100** | €1.300 |
| CAT3 terras | €500 | **€900** | €900 |

**Benchmark 32 dossiers selectie building (22 appartementen met woon €/m²):**
- woon €/m²: min €1.899, P25 €2.000, **mediaan €2.135**, P75 €2.495, max €3.300. = exact basis €2.150. Cap €2.900: 2 luxe-dossiers geclipt (intentioneel).
- CAT1-band [€1.600–€2.900] dekt alle appartementen. ✓

**Verbetering doorgevoerd — cat2/cat3 decoupled MIN → MAE-optimaal:**
- Was: cat2 €900, cat3 €500 (de min). Nu: **cat2 €1.200, cat3 €700** (MAE-optimaal op de appartement-benchmark).
- Per-dossier €/m² (22 app): cat2 mediaan €1.227 (MAE €900→411, €1100→278, **€1200→247**); cat3 mediaan €750 (MAE €500→237, **€700→215**, €900→253).
- m²-subtotaal mediaan-fout (expert-SQM, expert woon €/m²): **4,8% → 2,6%** (overview-P50 1100/900 gaf 2,9%).
- Code: `CAT2_DECOUPLED_BASIS=1200`, `CAT3_DECOUPLED_BASIS=700` (geclampt op settings); f-backcalculate meegetrokken; 39/39 tests groen.

**Grootschalige benchmark — 498 dossiers (harvest-prices.csv, ALLE types):**
- CAT1 woon: p10 €1050, p25 €1600, med €2000, p75 €2400, p90 €2937. Band [1600-2900] dekt 65% van álle types (25% eronder = goedkope loods/casco/woning; 11% erboven = luxe). Appartementen alleen (curated): med €2135, allemaal in band.
- CAT2 niet med €980 · CAT3 terras med €650 (breed). Breder dan appartementen omdat alle gebouwtypes meegerekend (loods, casco, open parking, groendak).
- → Model is appartement-gecalibreerd; goedkope niet-appartement-types vallen onder de band (bekende scope-grens).

**Gebouwtypes (per-type hoofdprijs, voor scope):** appartement med €2.135 · winkel €2.302–2.957 · woning €1.338–3.500 (breed) · loods/casco laag. Model is appartement-gecalibreerd; commercial/woning hebben eigen niveaus.

**Data:** scripts/bench-selectie.json (32), bench-commercial.json (5), bench-woning.json (5), bench-pricing.mjs (validatie).

## SQM — EINDSTAND (12 methodes getest + geleverde verbeteringen)

**Bewezen techniek-limiet:** autonome SQM-meting uit kale PDF-plannen via vision is niet betrouwbaar te maken. 12 methodes getest (maatketen, segment-som, floor-enum, netto-Opp×factor, deterministisch pixel, CV-wanddetectie, schaalbalk, tekst-Opp, multi-signaal+sanity, blinde-crop, vision-geleide-crop, ensemble median-of-3). Mediaan-fout 24% (gunstig subset) tot 46-89% (breed); kernoorzaak = **bimodale, input-onafhankelijke variantie** (zelfde gebouw −1%..−41%; footprint 73..7936) + systematische onder-telling grote gebouwen + extractie-uitval. **<10% (of betrouwbaar <25%) bestaat niet** uit kale plannen.

**GELEVERD (in code, getypecheckt, 44/44 tests):**
1. `classify-pages-local.ts` — floor-titel-detectie vangt nu Gelijkvloers/Ne verdieping/Niveau/Kelder → `multiPlan` 1/8→5/8 (input-gate).
2. `render-plans.ts` — aspect-bewuste per-plattegrond cropping (één plan/beeld → leesbaar).
3. `sqm-confidence.ts` + gewired in `run-estimation.ts` — **fysieke sanity-gating**: detecteert bruto<netto, ~0 woon, absurde m²/unit, gemiste verdiepingen → verlaagt `sqm_confidence`/`overall_confidence` + logt waarschuwing. De tool **flagt nu disasters** i.p.v. stil een foute SQM te geven. Vangt de egregieuze fails; de "plausibel-ogende" systematische onder-tellingen (beide signalen overeenstemmend fout) blijven onvangbaar zonder externe data.

**Voor échte <10%:** meetstaat/oppervlaktetabel in upload (tekst-parse), DWG/DXF-vectoren, of getraind plan-meetmodel. Niet haalbaar uit raster-PDF-plannen met vision.

## SQM-METHODE-VERGELIJKING (eerste 5 methodes, selectie building)
| Methode | mediaan-\|Δ\| | bevinding |
|---|---|---|
| v4 dimensie-keten (baseline) | ~35-40% | model raadt "welke maat is buitenwerks" fout |
| Segment-som footprint (per verdiep) | **−3% tot −21%** wanneer alle verdiepingen gedekt; mediaan 37% | meting OK, **verdieping-enumeratie** is het gat |
| Floor-enumeratie v5 (sectie+footprint×count) | **53% (slechter!)** | foute footprint × floor-count versterkt de fout (Die Prince +44%, 537092 −80%) |
| Netto-Opp × factor | factor 0,54–3,30 (instabiel) | labels lezen lukt; capture-volledigheid + over-telling onbetrouwbaar |
| Deterministisch pixel (schaal+DPI) | **−91%** | PDF-pagina niet op ware schaal (export wijzigt grootte) + model wijst 1 appartement aan i.p.v. gebouw |

**Conclusie: SQM-meting uit deze plannen via vision is fundamenteel onbetrouwbaar (35-91%).** Geen enkele methode haalt consistent <25%. Dit is een vision-model-limiet (zoals CLAUDE.md al noteerde over de v9-plateau), niet op te lossen met prompt-tuning. v5 is gestaged maar **NIET activeren** (gevalideerd slechter).

**Wat wél betrouwbaar is:** (1) pagina-selectie via kamerlabel-tekstdichtheid, (2) het lezen van ingeschreven netto Opp-labels (16/17 units correct), (3) cropping per plattegrond (render-plans.ts, gedaan). Het meten/optellen tot bruto is de limiet.

## Aanbevolen vervolg (realistisch)
1. **Netto-Opp als primair signaal** waar labels bestaan (betrouwbaar leesbaar) + confidence-flag; bruto via factor ~1,3 (±15% best-case).
2. **Confidence surfacing**: toon de gebruiker een SQM-betrouwbaarheid; bij lage confidence handmatige correctie vragen.
3. **Voor LAB/benchmark**: expert-berekening gebruiken (betrouwbaar tekst-extraheerbaar) i.p.v. vision-SQM.
4. **Prijs/F**: laten zoals het is (goed gecentreerd op €2.150); QQP-model voegt niets toe.

---

## SQM-ROUTER (geleverd + in pipeline gewired, 2026-05-31)

**Kerninzicht:** "alles moet werken" → geen één-methode-past-alles, maar een **router** die per dossier het beste beschikbare signaal kiest. De input is heterogeen; de pipeline detecteert het type en routeert.

| Bron | Detectie | Methode | Nauwkeurigheid |
|---|---|---|---|
| **area_table** (oppervlaktestaat/meetstaat/berekening in upload) | tekst-markers (`Totaal kapitaal…`, `Oppervlakte incl. btw`, `Opp/inhoud`) + ≥3 `<m²>…<waarde>`-rijen | **VISION** leest de tabel (exact), `classifyAreaRow` aggregeert → cat1/2/3 | **<10% — gevalideerd mediaan 0%, 23/23 binnen 5%** vs heated-floor GT |
| **net_labels** (ingeschreven Opp/BO-labels per unit) | `BO/Opp: <num> m²`-patroon | netto-som × bruto-factor ~1,3 | ±15% |
| **plan_vision** (kale lijntekening) | geen markers | vision-meting + **confidence-gating** (flagt disasters) | ~38%, eerlijk geflagd |

**Waarom vision en niet tekst-parse voor de tabel:** `pdftotext`/raw-tekst mis-alignt de kolommen (oppervlakte landt op verkeerde rij). De **aanwezigheid** van een tabel is betrouwbaar tekst-detecteerbaar; de **extractie** moet door vision (bewezen exact in `bench-experts-vision`).

**Gewired in `run-estimation.ts`** (single source of truth → ook live in de Railway-worker):
- `getPdfText()` + `detectSqmSource()` → bij `area_table`: `extractAreaTableViaVision()` met de bestaande Claude-client.
- Route A-areas **overschrijven** de vision-meting voor de kostberekening; `sqm_confidence` → ≥0,90 (exacte tabel).
- Geen tabel → vision-meting blijft, met sanity-gating zoals voordien.
- Telemetrie-log per dossier: welke bron gekozen werd.

**Nieuwe/gewijzigde bestanden:** `src/lib/sqm/sqm-router.ts`, `src/lib/sqm/extract-area-table.ts`, `src/lib/pdf/render-plans.ts` (`renderSpecificPagesToBase64`, `getPdfText`), `src/lib/pipeline/run-estimation.ts` (router-wiring). Tests: `src/lib/sqm/__tests__/sqm-router.test.ts` (12) + `sqm-confidence.test.ts` (5) — **17/17 groen, tsc schoon**.

**Eerlijke grens:** route A levert <10% **enkel wanneer de upload een gestructureerde oppervlaktetabel bevat**. Detectie op de "selectie building"-set: 6/37 (de rest zijn CAD-only plannen zonder extraheerbare tabeltekst → terecht `plan_vision` + flag). Voor die kale plannen blijft de vision-meting de limiet (~38%, geflagd voor handmatige review). De winst: élk input-type wordt nu naar de beste beschikbare methode geleid i.p.v. blind te meten.
