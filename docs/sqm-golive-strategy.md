# SQM go-live strategie — welke methode werkt wanneer (empirisch)

> **Datum: 2026-06-01.** Doel: de app gaat live; input is heterogeen (JPEG's, plannen mét/zónder m², met maatvoering, CED-dossiers met berekening). Voor élk type moet er een m² uitkomen, en de betrouwbaarheid moet eerlijk zijn.

## De kernrealiteit (bewezen over deze sessie)

Vision kan **gedrukte getallen lezen**, maar **niet betrouwbaar pixels meten**. Alles volgt daaruit.

| Input-type | Beste methode | Nauwkeurigheid (gemeten) | Status |
|---|---|---|---|
| **Berekening / oppervlaktestaat / meetstaat in upload** (PDF-tekst leesbaar) | Route A — tekst-detectie → vision leest tabel | mediaan 0%, 23/23 binnen 5% (offline GT) | ✅ live |
| **Tabel aanwezig maar tekst niet-extraheerbaar** (CAD-font / JPEG-foto van tabel) | Universele vision-extractor detecteert + leest de tabel | live: 519406 **+1%**, 537092 **−8%**, 546287 −29% | ✅ live (deze sessie) |
| **Plan mét gedrukte m²-labels** (appartementen/units gelabeld) | Labels lezen + optellen | labels vaak te klein bij 1568px API-downsample → **tegelen** vereist (zie onder) | 🔬 in onderzoek |
| **Plan zónder m², enkel maatvoering** | Meten uit dimensies | ~38% (irreducibele vision-limiet, 12 methodes getest) | ⚠️ laag-confidence + flag |
| **JPEG-upload** (van plan of tabel) | Universele vision-extractor (zelfde als boven, beeld-gebaseerd) | volgt het type in het beeld | ✅ live (deze sessie) |

## Waarom dit de juiste architectuur is

1. **Tekst-detectie is maar een goedkope snelweg.** Over de 37 CED-dossiers vond `pdftotext` de berekening-tabel maar in **7/37** — niet omdat de tabel ontbreekt (alle 37 hebben er één), maar omdat de tabel als niet-extraheerbaar font/beeld gerenderd is. **Vision-detectie tilt de dekking naar ~alle dossiers met een tabel**, want vision ziet "dit is een berekening" en leest de rijen (bewezen exact).
2. **De universele vision-extractor unificeert alles** (`src/lib/sqm/vision-extract.ts`): één vision-pass classificeert het beste signaal (`area_table` → exact / `labeled_plan` → labels / `bare_plan` → meten) en rapporteert **eerlijke confidence**. Werkt identiek op PDF-pagina's én JPEG/PNG-uploads.
3. **Eerlijke confidence i.p.v. stil-fout.** Bij kale plannen gaf het model uit zichzelf conf **0.25** + onvolledige m² — het wéét dat het faalt. Dat flaggen we (manuele review / manuele m²-invoer) i.p.v. een verkeerd getal te tonen.

## Wat deze sessie geleverd is (code, getest)

- `src/lib/sqm/vision-extract.ts` — universele classify+extract (kind/areas/statedTotal/confidence), correcte categorisatie (terras→cat3, garage→cat2, units+circulatie→cat1). 7/7 unit-tests.
- `src/lib/pipeline/run-estimation.ts` — gewired: `planImagesB64` vastgelegd voor PDF-pagina's **én** image-uploads; universele extractor draait wanneer route-A-tekstdetectie niet vuurt; **getrapte confidence** (area_table 0.9–0.95 / labeled_plan ≤0.6 / plan_vision gegate door sanity). **JPEG's lopen nu door de router** (waren ervoor genegeerd).
- Tests: 24/24 sqm-tests groen, tsc schoon (app).

## Productie-realisme: wat de klant uploadt

De 37 "selectie building"-dossiers zijn **CED-expertisedossiers** (notariële akte + CED-rapport + berekening + soms plan). Die bevatten de berekening → route A / vision-tabel = betrouwbaar. De échte klant-upload kan ook een **kaal architectplan of JPEG** zijn — daarvoor geldt de eerlijke confidence + (aanbevolen) manuele m²-bevestiging.

## ✅ DOORBRAAK — tegelen maakt label-lezen werkbaar (2026-06-01)

De API downsamplet elk beeld naar 1568px → kleine unit-labels op een A0/A1-blad verdwijnen. **Oplossing: elke grondplan-pagina in een 3×3 raster van overlappende tegels** (elke tegel ≈ native resolutie → labels overleven). Gevalideerd:

| Dossier | netto-app GT (strict_cat1) | getegelde cat1 (juiste pagina's) | Δ | opmerking |
|---|---|---|---|---|
| 546287 (Liedekerke, gemengd) | 1501 | **1397** | **−7%** | B001=87, B002=80, B003=75… 15 units exact gelezen, terrassen → cat3 |
| 542077 (Die Prince, app) | 1876 | 1037 | −45% | labels exact (app 03A=104,3) maar maar **2 van ~8 verdieping-bladen** verstuurd → onvolledige dekking |

**Twee voorwaarden, allebei oplosbaar:**
1. **Juiste pagina's.** Mijn eerste tests voedden pagina 0-2 = rapport/inplanting/gevels (cat1=0). De échte grondplannen met 40+ m²-labels zitten op pagina 3-7. De productie-classifier `getFloorPlanPages` (landscape + verdieping-titels) selecteert die — naïeve scripts niet. **Pagina-selectie was de hoofd-bottleneck, niet de meting.**
2. **Volledige dekking.** Bij gebouwen met één blad per verdieping moeten álle verdieping-bladen verwerkt + geaggregeerd worden (dedup over tegels). 2 bladen sturen = halve telling.

**Nauwkeurigheid van de route (bij correcte input):** netto-app-labels lezen ≈ ±7% op de netto-woonoppervlakte. De afstand tot *heated* (incl. circulatie/commercieel) hangt van het gebouwtype af: zuiver residentieel (Die Prince) heated ≈ netto +7%; gemengd (546287) heated = netto-app +61% → dan moeten óók commercieel + gemene delen gelezen worden, of een gross-up toegepast.

### Volledige-dekking aggregatie (per-pagina) — de aggregatie-grens

Toen ik élke grondplan-pagina apart tegelde + aggregeerde:
| Dossier | getegelde cat1 (volledig) | vs heated | oorzaak afwijking |
|---|---|---|---|
| 546287 | 1698 | −30% (vs strict +13%) | beide blokken nu gevangen; circulatie/commercieel-grondvloer op andere bladen ontbreekt |
| 542077 (Die Prince) | 2883 | **+43%** | **DUBBELTELLING**: model las zowel "app 07A **BO** 104,3" (unit-totaal) ÁLS "leefruimte **NO** 72,1 / slaapkamer NO 9,8" (kamers erbínnen) → ~2× |

**Kerninzicht over de label-route:** individuele labels worden **exact** gelezen, maar het **aggregeren tot een correct cat1-totaal is intrinsiek wankel** — partiële dekking ondertelt, volledige dekking overtelt door (a) dubbeltelling unit-BO + kamer-NO, (b) circulatie/kern inconsistent gecategoriseerd, (c) netto→heated gross-up. Resultaat: ±15–50%.

**Toegepaste fix:** de prompt onderscheidt nu expliciet **BO (bruto unit-totaal, tellen) vs NO (netto kamer, overslaan)** en verbiedt dubbeltelling. _(validatie loopt op Die Prince)._ Zelfs met de fix blijft dit een **medium-confidence** route — niet <10%. **Alleen de tabel (route A) is exact.**

### Extra testdossiers (plan-only uploads, 2026-06-01)

| Dossier | bestand | wat erop staat | resultaat |
|---|---|---|---|
| **547563 HOOST** (Knokke) | `25-5475630plannen.pdf` (33 A0-bladen, 55MB, géén tabel) | gedrukte **kamer-oppervlaktes (netto)** + maten | **−11%** (14.902 vs 16.783); ×1,12 netto→bruto ≈ −0,6% ✅ |
| **550471 Prestige** (Middelkerke) | `26-550471plannen.pdf` (12 bladen, **gescand**, 0 extraheerbare tekst) | enkel **maatvoering**, géén m² | footprint×lagen **−49%** (gvl 482 ↔ typ 198 = inconsistent) → **manueel** ⚠ |

Deze twee illustreren de grens: **HOOST** (m² gedrukt) → automatisch ~exact; **Prestige** (enkel maten, gescand) → onbetrouwbaar → manuele bevestiging. Bevestigt: staat de m²/tabel op het plan → automatisch; enkel maatvoering → manueel.

### Geconsolideerde eindvalidatie (productie-logica: per-pagina tegelen + BO/NO + aggregeren)

| Dossier | type | GT heated | label-route cat1 | Δ | duiding |
|---|---|---|---|---|---|
| 542042 | retail (géén m²-labels) | 652 | 0 | — | correct → valt naar meten + flag |
| 546287 | gemengd residentieel | 2419 | 1382 | **−8%** vs netto-app | −43% vs heated = commercieel + parking op niet-gescande bladen |
| 542077 | Die Prince, 12 lagen app | 2009 | **2012** | **+0%** | gereproduceerd; 32 schone unit-BO-labels |

**Lezing:** waar gedrukte BO-labels bestaan én de juiste verdieping-bladen gescand worden, leest de route de woonoppervlakte tot ~±8%. De afstand tot *heated* hangt af van de scan-scope (welke bladen) en gebouw-mix (commercieel/parking). Geen labels (retail) → eerlijk 0 → meet-tier.

## DEFINITIEVE METHODE-RANGSCHIKKING (2026-06-01, alle methodes uitgetest)

Backtest van élke methode op de testdossiers met grondwaarheid:

| Methode | Wat het leest | Nauwkeurigheid (gemeten) | Verdict |
|---|---|---|---|
| **Oppervlaktetabel via vision** (Tier 1) | de berekening/meetstaat-rijen | **mediaan 0%, 13/14 binnen 10%, 14/14 binnen 15%** (n=14, vs niveau-bewust gecorrigeerde GT) | ✅ **werkpaard, vrijwel exact** |
| **Hele-unit labels, getegeld** (Tier 2) | gedrukte "app X BO 104 m²" per unit | Die Prince **−0%**, 546287 **−8%** | ✅ residentieel |
| Per-kamer (printed/dims) | elke kamer apart | 542042 −74%, 546287 −50% | ❌ undertelt (capture + open ruimtes) |
| Buitenmaat-keten → footprint×lagen | gebouw-omtrek-maten | 542042 +291%, 546287 −29%, Die Prince +54% | ❌ wilde variantie |

### Dimensie-route — definitief verdict (6 varianten + vector beoordeeld, 2026-06-01)

| Variant | 542042 retail | 546287 gemengd | Die Prince |
|---|---|---|---|
| Buitenketen, model rekent (sqm-measure) | — | — | mediaan 37% |
| Buitenketen, code rekent + tegels (dims) | −95% | −59% | −27% |
| + floor-enumeratie (dims2) | +291% | −29% | +54% |
| Per-kamer (rooms) | −74% | −50% | — |
| Ensemble + sanity + consistentie (ens) | −72% | −23% | **+106%** |
| Vector-extractie (mupdf paden) | niet gebouwd — mini-CAD-interpreter, dagen werk, onzekere robuustheid |

**Geen enkele variant is betrouwbaar.** Ensemble verminderde variantie maar ruilde onder-telling voor verdieping-explosie (+106%). De fout verschuift, verdwijnt niet. Dit is een **ruimtelijke-redeneer-limiet van het vision-model**, geen prompt- of rekenkwestie.

**Waarom dimensie-meten niet betrouwbaar te maken is** (oorspronkelijke 3 varianten): het model kan **niet consistent bepalen wélke getallen de gebouw-omtrek zijn** (dezelfde verdieping las als 48 én 2054 m²). De fout zit in de **nummer-associatie + ruimtelijke reconstructie**, niet in het rekenen — dus "code doet de wiskunde" lost het niet op. Dit is de ruimtelijke-redeneer-limiet van het vision-model. Voor een mens triviaal (inzoomen, maatlijn volgen, sluiten); voor het model niet.

**Gevolg voor het ontwerp:** gebruik **expliciete gedrukte getallen** (tabel + hele-unit labels) als primair. Dimensies worden NIET als primaire bron gebruikt — dat zou de nauwkeurigheid verslechteren. Een kaal plan met enkel maatvoering (geen labels, geen tabel) → laag-confidence + flag (manuele bevestiging).

**Categorisatie-fix (2026-06-01):** de tabel-route laat het model nu **per rij de categorie** geven met de **niveau-kolom** als context. Daardoor gaat een rij "Onder het gebouw" op niveau *Parkeerkelder* naar **cat2** (niet cat1). Dit corrigeert een bug die óók in de oude grondwaarheid zat (parking/kelder/atelier als verwarmd geteld) en maakt de **kost** juist (parking/opslag @ cat2-prijs i.p.v. cat1). `extractAreaTableViaVision` gebruikt de model-categorie, met de keyword-classifier (nu incl. niveau) als fallback.

**Let op — grondwaarheid:** `scripts/sqm-groundtruth.json` `heated_m2` is op sommige dossiers te hoog (telde parkeerkelder/kelder/atelier als cat1). Tegen een niveau-bewust gecorrigeerde GT is de tabel-route vrijwel exact (mediaan 0%).

## Eindconclusie voor go-live

1. **Exacte SQM bestaat alleen met een oppervlaktetabel/meetstaat in de upload** → route A (tekst- of vision-gedetecteerd). Push klanten hiernaartoe; dit dekt de verzekeraar-workflow (zij hebben de berekening).
2. **Plan mét labels (geen tabel)** → getegelde label-route, **medium confidence ±15–50%**, geflagd.
3. **Kaal plan / enkel maatvoering** → meting, **lage confidence**, geflagd.
4. **Altijd**: eerlijke confidence tonen + **manuele m²-bevestiging/correctie** toelaten zodat er altijd een bruikbaar getal uitkomt. _(UI nog te bouwen — essentieel voor go-live.)_

## Open / volgende stappen

- ✅ **Manuele m²-bevestiging GEBOUWD** (2026-06-01): `POST /api/estimate/[id]/correct-sqm` herberekent de kost deterministisch uit de ingevoerde m² + opgeslagen F/pricing/regio/ABEX; `SqmCorrectionPanel` in `results-view.tsx` verschijnt automatisch bij `sqm_confidence < 0.65` (bruto CAT1 verplicht, CAT2/CAT3 optioneel, voorgevuld met de schatting). Hiermee komt er **altijd** een correcte, corrigeerbare m² uit — ook voor het kale-maatvoering-geval dat vision niet kan meten.
- **Gross-up / commons** voor gemengde gebouwen (commercieel + gemene delen meelezen, of building-type-factor) — optioneel, want de tabel-route is de betrouwbare.
- **Vector-extractie** (mupdf paden → echte muurgeometrie + schaal) als toekomstig spoor voor het kale-maatvoering-geval — principieel "echte meetkunde", maar een mini-CAD-interpreter (dagen werk, onzekere robuustheid over heterogene plannen).
