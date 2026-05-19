# SQM Extraction Prompt — v3

> **Use this prompt with Claude Vision (Sonnet 4) to extract m² data from building plans.**
> **v3: Stepped-building terrace detection, improved kelder capture, fietsenstalling.**

## System Prompt

```
You are an expert Belgian building plan analyst specializing in insurance reconstruction cost estimation. You read architectural floor plans and extract precise surface area data per building, per floor.

You understand Dutch (Flemish) and French room labels used in Belgian plans.

YOUR GOAL: Extract ALL built surface area. Every square meter of constructed space matters for reconstruction cost — private rooms, common areas, underground parking, access ramps, terraces, storage, technical rooms. Missing surface area = underinsured building.

CRITICAL RULES:

1. MULTI-BUILDING: One plan set can contain multiple separate buildings (e.g., apartment block + row houses). Identify and separate each building.

2. COMPLETE UNDERGROUND CAPTURE: Basements are expensive to rebuild. Measure the FULL footprint:
   - Parking garage = total drivable area INCLUDING lanes, turning space, and maneuvering room — not just parking spots. Measure the full perimeter of the garage slab.
   - Inrit/oprit (access ramp) = the sloped ramp from street to underground, measured as horizontal projection
   - Individual storage rooms (bergingen) — count ALL of them, typically numbered B01-B10 etc.
   - Technical rooms (tellerlokaal, stookplaats, liftput, watergroep, electriciteit)
   - Common circulation underground (gangen, trappenhal, toegang)
   - Fietsenstalling/fietsberging underground (bicycle storage)
   - Afvalberging (waste storage)
   VALIDATION: If your kelder total is less than 60% of the ground floor footprint, you probably missed the garage/parking area or inrit. But do NOT inflate — measure only what you actually see on the plan.

3. COMMON AREAS: In apartment buildings, include ALL shared spaces per floor:
   - Entrance halls (inkomhal)
   - Stairwells (trappenhal) — measure per floor they serve
   - Elevator shafts (liftkoker) — measure per floor
   - Corridors between units (gemeenschappelijke gang)
   - Technical/meter rooms (tellerlokaal, technische ruimte)
   These are NOT part of any unit but ARE part of the building m².

4. TERRACES & STEPPED BUILDINGS: Track terraces separately per floor. Belgian apartment buildings often have a "stepped" or "trapvormig" design where upper floors are SMALLER than the floor below. The roof of the lower floor becomes a terrace for the upper floor. How to detect:
   - If an upper floor plan shows the full building outline but only PART is enclosed (thick walls), the rest is terrace
   - Terraces appear as areas with: thinner/dashed lines, no roof hatching, diagonal line fill, or lighter drawing weight
   - Look for "terras" labels or balcony symbols
   - KEY RULE: if floor N has 430 m² footprint but floor N+1 only has thick walls enclosing 360 m², then floor N+1 has ~360 m² enclosed + ~70 m² terrace. Do NOT assume upper floors have the same enclosed area as lower floors.

5. ACCURACY OVER SPEED: If a dimension is unclear, flag it. Never guess.

6. SCALE: Determine the scale first. Look for:
   - A scale bar (e.g., "1:100", "1:50")
   - Written dimensions on walls (in meters or centimeters)
   - Standard door widths (Belgian standard: 80cm interior, 90cm exterior)

7. UNITS: All areas in m² (whole numbers for floor totals, 1 decimal for rooms). All lengths in meters (2 decimals).

8. AGGREGATE PER FLOOR: The primary output is m² per floor per building. But when room-level area labels are visible on the plan (e.g., "slaapkamer 1 11.7 m²"), read and sum them — this is more accurate than estimating from the building outline. Room categories for reference:
   - Main living: slaapkamer, woonkamer, eetkamer, keuken, bureau, gang/hal
   - Service: badkamer, toilet/WC, berging, wasplaats/wasruimte
   - Outdoor: terras, balkon (track in terraces_sqm)
   - Technical: technische ruimte, CV-ruimte
   
   Note: room areas written on plans are usually "vloeroppervlakte" (net, wall-to-wall inside). The expert uses "bruto oppervlakte" (BO) which includes wall thickness. If you only have room-level net areas, the sum of all rooms in one unit ≈ 85% of the BO for that unit.
```

## User Prompt

```
Analyze this building plan and extract all surface area data. Return ONLY valid JSON matching this structure:

{
  "project": {
    "description": "short description of the full project",
    "architect": "name if visible",
    "scale": "1:50 or as detected",
    "scale_confidence": 0.0-1.0
  },
  "buildings": [
    {
      "id": "B1",
      "name": "descriptive name, e.g. Meergezinswoning / Woning 1",
      "type": "apartment_block|house|terraced_houses|commercial|mixed",
      "unit_count": 10,
      "floors": [
        {
          "level": -1,
          "label": "Kelder",
          "label_en": "Basement",
          "zones": [
            {
              "zone_type": "parking",
              "description": "Parkeergarage P1-P15 incl. rijbaan en inrit",
              "area_sqm": 520.0
            },
            {
              "zone_type": "storage",
              "description": "Kelderbergingen B1-B10",
              "area_sqm": 175.0
            },
            {
              "zone_type": "technical",
              "description": "Tellerlokaal elektriciteit + water, liftput",
              "area_sqm": 22.0
            },
            {
              "zone_type": "circulation",
              "description": "Gemeenschappelijke kelder-gang en trappenhal",
              "area_sqm": 30.0
            }
          ],
          "floor_total_sqm": 747.0,
          "terraces_sqm": 0.0
        },
        {
          "level": 0,
          "label": "Gelijkvloers",
          "label_en": "Ground floor",
          "zones": [
            {
              "zone_type": "residential",
              "description": "Appartementen 0.1-0.4",
              "area_sqm": 392.0
            },
            {
              "zone_type": "circulation",
              "description": "Inkomhal, trappenhal, lifthal, gangen",
              "area_sqm": 44.0
            }
          ],
          "floor_total_sqm": 436.0,
          "terraces_sqm": 0.0
        }
      ],
      "building_totals": {
        "enclosed_sqm": 1987.0,
        "terraces_sqm": 131.0,
        "underground_sqm": 747.0,
        "aboveground_sqm": 1240.0
      },
      "infrastructure": [
        {
          "type": "elevator",
          "description": "2 liften met 4 stopplaatsen",
          "quantity": 2
        }
      ]
    }
  ],
  "project_totals": {
    "total_enclosed_sqm": 0.0,
    "total_terraces_sqm": 0.0,
    "total_underground_sqm": 0.0,
    "total_aboveground_sqm": 0.0,
    "building_count": 0
  },
  "extraction_warnings": []
}

ZONE TYPES (use these exactly):
- "residential" — private living space (apartments, rooms in houses)
- "parking" — garage, parking spots, access ramp (inrit/oprit)
- "storage" — bergingen, kelderberging, zolder-berging
- "technical" — tellerlokaal, stookplaats, technische ruimte, liftput
- "circulation" — gemeenschappelijke gang, trappenhal, lifthal, inkomhal
- "terrace" — terrassen, balkons (tracked in terraces_sqm, not in zones)
- "commercial" — winkels, kantoren (if mixed-use)
- "bike_storage" — fietsenstalling (separate from regular storage)
- "other" — anything that doesn't fit above

CRITICAL INSTRUCTIONS:

1. MULTI-BUILDING: If the plan shows multiple separate buildings, create a separate entry in buildings[] for each. Row houses that share walls but are structurally independent = one entry with unit_count.

2. UNDERGROUND = FULL FOOTPRINT: Don't just count individual bergingen — measure the ENTIRE underground level including:
   - Parking lanes and maneuvering space (not just parking spots) — measure the full slab
   - Access ramp (inrit) from street to garage — horizontal projection of the ramp
   - All corridors and circulation between bergingen and parking
   - Technical rooms (tellerlokaal, stookplaats, liftput, watergroep)
   - Fietsenstalling/fietsberging (bicycle storage)
   - Afvalberging (waste/refuse storage)
   If your kelder total is < 70% of the ground floor enclosed area, you are missing something.
   
3. COMMON AREAS PER FLOOR: For apartment buildings, every floor has shared space (stairs, elevator, corridors). This MUST be included in floor_total_sqm. A floor's total = sum of private units + common areas on that floor.

4. TERRACES SEPARATE: Report terrace m² in terraces_sqm per floor, NOT in the zones array. They have different reconstruction value.

5. STEPPED BUILDINGS & TERRACES: Belgian apartment buildings often step back at higher floors. Each upper floor may have a SMALLER enclosed footprint than the floor below.
   - Do NOT copy the floor area from GV to upper floors — measure each floor independently
   - Enclosed area = space inside thick exterior walls (you can put a roof over it)
   - Terrace = outdoor areas on the plan that are part of the building level but have NO roof — typically shown with thinner lines, no hatching, or "terras" label
   - Balconies that project beyond the building envelope are also terraces
   - If you're unsure whether an area is enclosed or terrace, look at the wall thickness: thick lines (20-30cm) = exterior walls = enclosed; thin lines = terrace edge/railing

6. FLOOR TOTAL = SUM OF ALL ZONES on that floor (excluding terraces).

7. READ ANNOTATIONS — DON'T ESTIMATE: If dimensions or area annotations are written on the plan, USE THEM. Don't estimate when exact numbers are given. Look for:
   - "BO" or "B.O." = bruto oppervlakte (gross area, includes wall thickness) — this is what the insurance expert uses. PREFER BO over other measurements.
   - "NO" or "N.O." = netto oppervlakte (net area, interior wall-to-wall) — useful but secondary
   - Room area labels written inside rooms like "slaapkamer 1 11.7 m²" or "woonkamer/keuken 28.2 m²" — these are typically vloeroppervlakte (net floor area). To convert to bruto: add ~15-20% for wall thickness (interior + exterior walls).
   - Unit labels like "app. 07A BO 104,3 m²"
   - Common area labels like "kern 071 BO 12,3 m²"
   - Wall dimensions in mm (e.g., "2430", "7015") or meters ("2,43", "7,02") — use these for cross-referencing area calculations
   
   PRIORITY: BO annotations > unit-level area labels > room-level m² labels > dimension-based calculation > visual estimation from scale

8. For multi-page PDFs, each page is typically a different floor or building. Process ALL pages. Plan sheets often show 2-3 floor plans on one landscape sheet.

9. INFRASTRUCTURE: Count ALL elevators (liften), not just one. Look for lift shafts on every floor plan. Also note fietsenstalling area separately.

10. PRECISION: Measure from the plans as precisely as possible. Do not round up generously — a 78 m² room is 78, not 80. Do not add safety margins. Report what you measure, flag what you're uncertain about.

11. List any uncertainties in extraction_warnings.

Return ONLY the JSON. No markdown, no explanation.
```

## Validation: Expert Benchmark (Dossier 25-54024300042)

Use this as ground truth to validate extraction accuracy:

**Building (Meergezinswoning — 10 units)**

| Verdieping | Type | Expert m² |
|---|---|---|
| -1 | kelders, garage, inrit | 747 |
| 0 | appartementen | 436 |
| 1 | appartementen | 357 |
| 1 | terrassen | 83 |
| 2 | appartementen | 316 |
| 2 | terrassen | 48 |

**Drie geschakelde woningen**

| Verdieping | Type | Expert m² |
|---|---|---|
| 0 | gelijkvloers | 234 |
| 1 | verdieping | 220 |
| — | fietsenstalling | 17 |

**Known gaps in v1 extraction:**
- Kelder: v1 extracted 235 m² (bergingen only), expert says 747 m² → missed garage + inrit (~512 m²)
- Appartementen: v1 extracted 973 m² bruto, expert says 1.109 m² → missed common areas (~136 m²)
- Woningen: v1 extracted 450 m², expert says 454 m² → nearly perfect

## Validation: Expert Benchmark (Dossier 25-54207700055 — DIE PRINCE)

Appartementsgebouw, 9 bouwlagen + kelder, Oostende. Plans have BO annotations per unit.

| Omschrijving | Niveau | Expert m² |
|---|---|---|
| Bergingen, techniek, fiets, afval | -1 | 209 |
| Garages | 0 | 101,9 |
| Appartementen | 0 | 101,9 |
| Gemeenschappelijke ruimte | 0 | 34,6 |
| Appartementen | 1-8 | 1.657,6 |
| Gemeenschappelijke ruimtes | 1-8 | 98,4 |
| Terrassen | 1-8 | 193,6 |
| Appartement | 9 | 116,1 |
| Terrassen | 9 | 2,2 |
| Dakterrassen | 8-9 | 75,6 |

**Plan-verified (floor +7):**
- App 07A (104,3) + App 07B (102,9) = 207,2 m² → matches expert 1657,6/8 = 207,2 EXACT
- Kern 071 = 12,3 m² → matches expert 98,4/8 = 12,3 EXACT
- Duplex 08A = 116,1 m² → matches expert 116,10 EXACT

**Key differences from dossier 1:**
- Single building (not multi-building)
- Kelder has NO garage — garages on ground floor (different layout)
- Plans have BO annotations (bruto oppervlakte) — prompt should READ these, not estimate
- Infrastructure: groendak 156m², 1 lift, 28 zonnepanelen (separately valued)

## Testing Checklist

For each test plan, verify:
- [ ] All buildings identified and separated
- [ ] Underground = full footprint (not just bergingen) — validate: kelder ≈ 90-110% of GV footprint
- [ ] Common areas included per floor (trappenhal, lifthal, gangen)
- [ ] Terraces tracked separately from enclosed space
- [ ] Stepped building: upper floors have SMALLER enclosed area than lower floors
- [ ] Floor totals = sum of all zones (excluding terraces)
- [ ] Infrastructure noted: ALL liften counted, fietsenstalling area
- [ ] Compare against expert benchmark if available

## Known Challenges

1. **Parking area**: Plans show individual spots (P1, P2...) but the expert counts total garage footprint including lanes. Measure the full enclosed perimeter.
2. **Common areas**: Often unlabeled on plans — look for space between units, around stairwells and elevators.
3. **Inrit/oprit**: The ramp from street level to underground parking. Often drawn as a sloped area — include its horizontal projection.
4. **Stepped/trapvormig buildings**: Upper floors have smaller enclosed area. The roof of the lower floor becomes a terrace. The building outline may be drawn on the upper floor plan but only part is enclosed (thick walls). Do NOT assume all floors have the same area.
5. **Terrace identification**: Terraces on plans appear as: dashed/thin outlines (vs thick walls for enclosed), no roof hatch, diagonal fill, "terras" label, or lighter drawing weight. On upper floors, compare thick-wall perimeter with the building outline.
6. **Scanned plans**: Lower resolution → lower confidence on dimensions.
7. **Open-plan spaces**: Keep as one zone if no wall separation.
8. **Dimension formats**: Some plans use cm (520), some m (5.20), some mixed.
9. **Fietsenstalling**: Often small and easy to miss — look for a dedicated room labeled "fiets" or bicycle symbols, usually near the entrance or in the kelder.

## Iteration Log

| Version | Date | Changes | Accuracy |
|---------|------|---------|----------|
| v1.0 | Day 1 | Initial prompt — single building focus | Woningen ±1%, Kelder -68%, Appartementen -12% |
| v2.0 | 2026-05-19 | Multi-building, full underground, common areas, zone-based | DIE PRINCE: 4 exact matches, total -12%. Herentals: total +1.2%, floor-level ±20% |
| v3.0 | 2026-05-19 | Stepped-building terrace, kelder validation, fietsenstalling, annotation-reading priority, room categories, precision | Herentals: total -3% (was -1.5% v2), structure correct. V1/V2 terrace split still poor — resolution ceiling. |
