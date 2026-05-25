# Dossier Test Tracking

> Handmatige tests om min/max categorieprijzen empirisch te bepalen.
> Per dossier: expert waarden vs pipeline output.
> Doel: na voldoende datapunten (F, expert_prijs/m²) de juiste min/max fitten.

## Formule

```
CAT_price(F) = CAT_min + (F − 0.70) / 0.80 × (CAT_max − CAT_min)
Total = (Cat1×P1 + Cat2×P2 + Cat3×P3) × Regional × ABEX
```

ABEX 2026-S1 = 1.056

---

## Dossier 1: 25-525116 — Dijkstraat 54A, 9240 Zele

**Type:** Mixed (bistro + B&B + woning)
**Postcode:** 9240

### Expert waarden
| | m² | prijs/m² | kost |
|---|---|---|---|
| Cat1 | ? | ? | ? |
| Cat2 | ? | ? | ? |
| Cat3 | ? | ? | ? |
| **Totaal** | | | **€1,442,864** |

> TODO: expert cat-breakdown uit expert PDF halen

### Pipeline output
| | m² | prijs/m² | kost |
|---|---|---|---|
| Cat1 | 775 | €2,202 | €1,706,590 |
| Cat2 | 200 | €1,178 | €235,574 |
| Cat3 | 20 | €685 | €13,705 |
| **Totaal** | | | **€2,065,398** |

- **F-coëfficiënt:** 1.0705
- **Finishing level:** Comfort
- **ABEX:** 1.056
- **Regional factor:** 1.0 (postcode niet gevonden)
- **Processing time:** 127s
- **SQM accuracy:** Perfect (0.02% error)
- **Kost error:** +43%

### Notities
- Zolder 66m² als Cat1 → moet Cat2 (prompt al gefixed in v2)
- Na zolder fix: Cat1=709, Cat2=266 → geschatte kost ~€1,994k (+38%)
- Prijzen systematisch te hoog door DB min/max settings
- QQP positieve bias bij mixed-use gebouw (groot = luxe)
- Regionale factor werkt niet (postcode range matching kapot)

### Teruggerekende expert prijs/m² (bij F=1.07, ABEX=1.056)
- Expert totaal / ABEX = €1,442,864 / 1.056 = **€1,366,350** (voor ABEX)
- Als cat1=709, cat2=266, cat3=20 (na zolder fix):
  - Geschatte expert Cat1 prijs ≈ **€1,596/m²** (aanname P2≈0.53×P1, P3≈0.31×P1)

---

## Dossier 2: 24-520212 — Opel Dealer Diksmuide (IJzerlaan 2 + Gasthuisstraat 12/1)

**Type:** Commercieel (autohandel — showroom + werkplaats)
**Postcode:** 5294 (Voet Diksmuide)
**Estimation ID:** 502d1081-dfb1-4868-8b2c-c873ac4cba1c

### Expert waarden (CED/AXA, ABEX 1048)

**IJzerlaan 2:**
| Zone | m² | prijs/m² | kost |
|---|---|---|---|
| Showroom/burelen | 500 | €1,550 | €775,000 |
| Werkplaats | 870 | €800 | €696,000 |
| Zonnepanelen 168× | — | €400/st | €67,200 |
| **Subtotaal** | **1,370** | | **€1,538,200** |

**Gasthuisstraat 12/1:**
| Zone | m² | prijs/m² | kost |
|---|---|---|---|
| Showroom/bureel | 370 | €1,200 | €444,000 |
| Opslagruimte | 150 | €600 | €90,000 |
| **Subtotaal** | **520** | | **€534,000** |

| | **TOTAAL** | **1,890m²** | | **€2,072,200** |

Expert cat-mapping:
- Cat1 (showroom/burelen): 500 + 370 = **870m²** → gem. **€1,401/m²**
- Cat2 (werkplaats + opslag): 870 + 150 = **1,020m²** → gem. **€770/m²**
- Cat3: 0m²

### Pipeline output
| | m² | prijs/m² | kost |
|---|---|---|---|
| Cat1 | 1,740 | €2,851 | €4,960,380 |
| Cat2 | 150 | €1,477 | €221,593 |
| Cat3 | 0 | €885 | €0 |
| **Totaal** | | | **€5,472,163** |

- **F-coëfficiënt:** 1.4697 (Luxury!)
- **Finishing level:** Luxury
- **ABEX:** 1.056 (expert: 1048)
- **Regional factor:** 1.0 (postcode niet gevonden)
- **Building type:** commercial
- **Processing time:** 132s (snel — maar 4 pagina's)
- **Kost error:** +164%

### Problemen
1. **Cat-classificatie zwaar fout**: Werkplaats 870m² als Cat1 i.p.v. Cat2. Pipeline telt 1,740m² cat1 vs expert 870m².
2. **F=1.47 absurd**: QQP-systeem is residentieel — "no bedroom, no kitchen" = -1.0, maar "huge space" = +1.0. Ridge regression balanceert dit verkeerd.
3. **Prijzen per m² dubbel te hoog**: Cat1 €2,851 vs expert €1,401 (+104%), Cat2 €1,477 vs expert €770 (+92%)
4. **Zonnepanelen niet apart geprijsd**: Expert rekent 168×€400=€67,200 apart. Pipeline negeert dit.
5. **Twee gebouwen als één behandeld**: Expert heeft aparte berekening per adres met verschillende prijzen/m².

### Teruggerekende expert prijs/m² (genormaliseerd naar ABEX 1056)
- Expert totaal bij ABEX 1056: €2,072,200 × (1056/1048) = **€2,088,015**
- Cat1 (showroom) gem.: €1,401 × (1056/1048) = **€1,412/m²**
- Cat2 (werkplaats/opslag) gem.: €770 × (1056/1048) = **€776/m²**

---

## Dossier 3: (overgeslagen — incompleet PDF, geen plattegronden)

---

## Dossier 4: 25-539008 — Brugse Steenweg 28, 8630 Veurne

**Type:** Appartementsgebouw met ondergrondse parkeergarage ✓ (in scope)
**Postcode:** 8630 Veurne
**Estimation ID:** 2c7d4ea5-c5a9-4f8f-aeb0-254c213cc6cd

### Expert waarden (CED/Allianz, ABEX 1057)

| Zone | Niveau | m² | Waarde |
|---|---|---|---|
| Appartementen | 0–3 | 1.553 | €3.610.725 |
| Gemeenschappelijke ruimtes | 0–3 | 176 | €338.800 |
| Parking/garage/bergingen | -1 | 790 | €809.750 |
| Inrit | -1 | 55 | €18.425 |
| Terrassen + dakterrassen | 0–3 | 516 | €322.409 |
| **Cat1 (app + gem.)** | | **1.729** | **€3.949.525** |
| **Cat2 (parking + inrit)** | | **845** | **€828.175** |
| **Cat3 (terrassen)** | | **516** | **€322.409** |
| Onroerende inrichting (liften, zonnepanelen) | | — | €186.150 |
| **Totaal** | | | **€5.286.259** |

Expert prijs/m² (pre-ABEX, genormaliseerd):
- Cat1: €3.949.525 / 1.057 / 1.729 = **€2.161/m²**
- Cat2: €828.175 / 1.057 / 845 = **€927/m²**
- Cat3: €322.409 / 1.057 / 516 = **€591/m²**

### Pipeline output
| | m² | prijs/m² | kost |
|---|---|---|---|
| Cat1 | 1.729 | €2.610 | €4.512.201 |
| Cat2 | 845 | €1.366 | €1.154.290 |
| Cat3 | 516 | €811 | €418.312 |
| **Totaal** | | | **€6.425.552** |

- **F-coëfficiënt:** 1.3213 (Comfort+)
- **ABEX:** 1.056 (expert: 1.057)
- **Regional factor:** 1.0 (postcode niet geëxtraheerd)
- **Processing time:** 154s
- **SQM accuracy:** ⭐ Perfect — Cat1 0%, Cat2 0%, Cat3 0% error
- **Kost error:** +21.6% (pipeline €6.426k vs expert €5.281k genorm.)

### Notities
- SQM extractie volledig correct — pipeline vindt exact dezelfde m² als expert
- Kostfout komt 100% van te hoge prijzen per m² (niet van SQM-fout)
- Cat2 prijs meest fout: pipeline €1.366 vs expert €927/m² (+47%)
- Onroerende inrichting (liften €134k, zonnepanelen €12k) niet in pipeline
- Postcode 8630 niet geëxtraheerd (staat op luchtfoto, niet op plan)

### Teruggerekende expert prijs/m² (F=1.3213, pre-ABEX)
- **Cat1: €2.161/m²** (pipeline: €2.610, +21%)
- **Cat2: €927/m²** (pipeline: €1.366, +47%)
- **Cat3: €591/m²** (pipeline: €811, +37%)

---

## Dossier 5: 25-544992 — Bastenakenstraat 18-20, 8380 Zeebrugge

**Type:** Appartementsgebouw (meerdere blokken)
**Postcode:** 8380 (door LLM geëxtraheerd uit plannen ✓)
**Estimation ID:** 106474ca-202f-4051-953b-a4dc29101a94

### Expert waarden (CED/Allianz, ABEX 1057, regional 0.987)

| | m² | prijs/m² (met regional+ABEX) | kost |
|---|---|---|---|
| Cat1 (app. + gemeenschappelijk) | 1.007 | €2.530 | €2.548.373 |
| Cat2 (garage/bergingen) | 774 | €1.042 | €806.508 |
| Cat3 (terrassen/balkons) | ~269 | €369 | €99.257 |
| **Subtotaal** | | | **€3.454.137** |
| Onroerende inrichting (excl.) | — | — | €140.750 |

> Genormaliseerd naar ABEX 1056: €3.454.137 / (1057/1056) = **€3.450.876**

Expert prijs/m² (pre-ABEX naar 1056, MÉT regional 0.987):
- Cat1: €2.548.373 / (1057/1056) / 1.007 = **€2.528/m²**
- Cat2: €806.508 / (1057/1056) / 774 = **€1.041/m²**
- Cat3: €99.257 / (1057/1056) / 269 = **€369/m²**

### Pipeline output

| | m² | prijs/m² | kost |
|---|---|---|---|
| Cat1 | 1.007 | €2.608 | €2.626.520 |
| Cat2 | 755 | €1.365 | €1.030.841 |
| Cat3 | 96 | €810 | €77.783 |
| **Totaal** | | | **€3.686.586** |

- **F-coëfficiënt:** 1.3205 (Comfort+)
- **ABEX:** 1.000 (= 1056/1056) ✓
- **Regional factor:** 0.987 (postcode 8380 → Kust, range 8300–8699) ✓
- **Postcode extraction:** `"plan"` (LLM las 8380 correct uit plannen) ✓
- **Processing time:** 166s

### Vergelijking

| | Cat1 m² | Cat2 m² | Cat3 m² | Cat1 €/m² | Cat2 €/m² | Cat3 €/m² | Totaal |
|---|---|---|---|---|---|---|---|
| Expert (ABEX 1056) | 1.007 | 774 | ~269 | €2.528 | €1.041 | €369 | €3.450.876 |
| Pipeline | 1.007 | 755 | 96 | €2.608 | €1.365 | €810 | €3.686.586 |
| **Fout** | **0%** ✓ | **-2.5%** | **-64%** ❌ | **+3.2%** ✓ | **+31%** | **+119%** | **+6.8%** |

### Notities
- **Postcode LLM-extractie werkt** — 8380 correct gelezen ✓
- **Regionaal coëfficiënt correct toegepast** (0.987) ✓
- **Cat1 uitstekend**: 0% m²-fout, slechts +3.2% prijsfout ✓
- **Cat3 m² zwaar onderschat**: 96 vs ~269 (-64%) — pipeline mist terrassen/balkons in plannen
- **Cat2 prijs te hoog** (+31%): consistent met D4, DB-instellingen te hoog
- **Totaalfout +6.8%** — veel beter dan D4 (+21.6%); verbetering door correcte regionale factor

---

## Analyse (na meerdere dossiers)

### Datapunten: (F, expert prijs/m² pre-ABEX, MÉT regional) — alleen in-scope dossiers
| Dossier | Type | F | Expert Cat1 €/m² | Pipeline Cat1 €/m² | Cat1 err | Expert Cat2 €/m² | Pipeline Cat2 €/m² | Cat2 err | Totaal err |
|---|---|---|---|---|---|---|---|---|---|
| 25-539008 (D4) | Appartement | 1.32 | **€2.281** | €2.610 | +14% | **€568** | €1.366 | +141% | +22% |
| 25-544992 (D5) | Appartement | 1.32 | **€2.528** | €2.608 | +3.2% | **€1.041** | €1.365 | +31% | +6.8% |

> D4-prijzen gecorrigeerd: nieuw ABEX-formula (÷1056). D4 pipeline had regional=1.0 (postcode niet geëxtraheerd).

> Dossiers 1 (mixed) en 2 (commercieel) buiten scope — niet opgenomen.

### Observaties
- **Cat1 SQM extractie betrouwbaar**: beide dossiers 0% m²-fout
- **Cat3 SQM problematisch**: pipeline onderschat terrassen/balkons consistent
- **Cat2 prijs systematisch te hoog** (+31 tot +141%) — DB-instellingen te hoog
- **Cat1 prijs acceptabel bij correcte regionale coëfficiënt**: D5 slechts +3.2%
- **Regionale factor maakt groot verschil**: D4 miste korting van 1.3% (0.987), D5 had het correct

### Back-calculated nationale basisprijzen (pre-ABEX, pre-regional, F≈1.32)
| Dossier | Expert Cat1 nationaal | Expert Cat2 nationaal |
|---|---|---|
| D4 (8630, regional=0.987) | **€2.311/m²** | **€575/m²** |
| D5 (8380, regional=0.987) | **€2.561/m²** | **€1.055/m²** |
| **Gemiddelde** | **~€2.436/m²** | **~€815/m²** |

### Gefitte min/max (TODO: na ≥5 in-scope datapunten)
Op basis van 2 datapunten (beide F≈1.32, beide appartementen):
- Bij F=1.32: formule-factor = (1.32 − 0.70) / 0.80 = 0.775
- Gem. Cat1 nat. ≈ €2.436 → 2.436 = min + 0.775×(max-min)
- Gem. Cat2 nat. ≈ €815 → 815 = min + 0.775×(max-min)

Eerste indicaties (2 punten, hoge spreiding, onzeker):
- Cat1 min: ~€900–1.100 | Cat1 max: ~€2.700–2.900
- Cat2 min: ~€300–400 | Cat2 max: ~€850–950
- Cat3 min: ~€150–200 | Cat3 max: ~€400–450
