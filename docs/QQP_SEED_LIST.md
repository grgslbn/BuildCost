# QQP Seed List — Initial Parameters

> **These are the starting QQPs seeded by domain knowledge.**
> **The system will discover and propose additional ones from reference dossier analysis.**

## Categories

### A. SIZE & LAYOUT (quantitative)

| # | QQP Name | Data Type | Unit | Description | Expected Correlation |
|---|----------|-----------|------|-------------|---------------------|
| 1 | `total_livable_sqm` | numeric | m² | Total livable surface area | Neutral (already in base calc) |
| 2 | `entrance_hall_sqm` | numeric | m² | Size of entrance/hallway | Positive — larger = higher finish |
| 3 | `living_room_sqm` | numeric | m² | Main living room area | Moderate positive |
| 4 | `kitchen_sqm` | numeric | m² | Kitchen area | Moderate positive |
| 5 | `master_bedroom_sqm` | numeric | m² | Largest bedroom | Moderate positive |
| 6 | `avg_bedroom_sqm` | numeric | m² | Average bedroom size | Low positive |
| 7 | `largest_bathroom_sqm` | numeric | m² | Largest bathroom area | Strong positive |
| 8 | `garage_sqm` | numeric | m² | Garage area (0 if none) | Moderate positive |
| 9 | `terrace_balcony_sqm` | numeric | m² | Total outdoor covered area | Moderate positive |
| 10 | `circulation_ratio` | numeric | ratio | Circulation m² / total livable m² | Positive — generous circulation = higher finish |
| 11 | `floor_count` | numeric | count | Number of floors | Low |

### B. ROOM COUNT & COMPOSITION (quantitative)

| # | QQP Name | Data Type | Unit | Description | Expected Correlation |
|---|----------|-----------|------|-------------|---------------------|
| 12 | `bedroom_count` | numeric | count | Number of bedrooms | Low (more = bigger, not necessarily finer) |
| 13 | `bathroom_count` | numeric | count | Number of bathrooms/shower rooms | Strong positive |
| 14 | `toilet_count` | numeric | count | Number of separate toilets | Moderate positive |
| 15 | `bathroom_per_bedroom_ratio` | numeric | ratio | Bathrooms / bedrooms | Strong positive |
| 16 | `has_separate_dining` | boolean | — | Dedicated dining room exists | Moderate positive |
| 17 | `has_office` | boolean | — | Dedicated office/study | Moderate positive |
| 18 | `has_dressing` | boolean | — | Walk-in closet / dressing room | Strong positive |
| 19 | `has_laundry_room` | boolean | — | Dedicated laundry room | Moderate positive |
| 20 | `has_wellness` | boolean | — | Sauna, pool room, spa | Very strong positive |
| 21 | `has_basement` | boolean | — | Basement present | Low positive |
| 22 | `has_garage` | boolean | — | Garage present | Low positive |

### C. EQUIPMENT & FEATURES (qualitative)

| # | QQP Name | Data Type | Unit | Description | Expected Correlation |
|---|----------|-----------|------|-------------|---------------------|
| 23 | `kitchen_appliance_count` | numeric | count | Built-in appliances in kitchen | Strong positive |
| 24 | `has_kitchen_island` | boolean | — | Kitchen island present | Strong positive |
| 25 | `bathroom_luxury_score` | numeric | score (0-10) | Computed: bath(+2) + shower(+1) + double_sink(+2) + bidet(+1) + jacuzzi(+3) + heated_floor(+1) per bathroom, normalized | Strong positive |
| 26 | `has_fireplace` | boolean | — | Fireplace in any room | Moderate positive |
| 27 | `has_open_kitchen` | boolean | — | Kitchen open to living | Moderate positive (modern style) |
| 28 | `built_in_storage_count` | numeric | count | Built-in closets/storage units visible | Moderate positive |

### D. PROPORTIONALITY (derived — computed from raw data)

| # | QQP Name | Data Type | Unit | Description | Expected Correlation |
|---|----------|-----------|------|-------------|---------------------|
| 29 | `living_to_total_ratio` | numeric | ratio | Living area / total livable | Low — high ratio might mean fewer rooms |
| 30 | `wet_room_to_total_ratio` | numeric | ratio | (Bathrooms + kitchen + laundry) / total | Moderate positive |
| 31 | `outdoor_to_indoor_ratio` | numeric | ratio | Outdoor m² / livable m² | Moderate positive |
| 32 | `avg_room_size` | numeric | m² | Total livable / room count | Moderate positive |

## Scoring Methodology

### Bathroom Luxury Score (QQP #25)
For each bathroom, sum:
- Has bathtub: +2
- Has shower: +1
- Has double sink: +2
- Has bidet: +1
- Has jacuzzi: +3
- Has heated floor: +1

Total across all bathrooms, then normalize: `score = min(10, total_points / bathroom_count * 2)`

### Kitchen Equipment Score (QQP #23)
Count of: built_in_oven, built_in_dishwasher, built_in_fridge, built_in_microwave, built_in_steamer, wine_fridge, island, induction_hob

## Weight Initialization

Start all weights at **0.0** (neutral). After processing the first 10 reference dossiers with known prices, compute initial correlations and set weights proportionally.

Weight range: **-1.0 to +1.0** where:
- `-1.0` = strong negative correlation with finishing level
- `0.0` = no correlation
- `+1.0` = strong positive correlation with finishing level

## Discovery Protocol

When processing a new reference dossier:
1. Extract all known QQPs
2. Compute predicted finishing coefficient
3. Compare with actual (from known price)
4. If residual > 15%:
   - Ask Claude to analyze what in this plan might explain the gap
   - Propose new QQP candidates
   - Store as `discovery_source = 'ai_discovered'` with `is_active = false`
   - Activate after seeing the same QQP proposed 3+ times across different dossiers

## Finishing Coefficient Mapping

| Level | Coefficient Range | Typical QQP Profile |
|-------|------------------|---------------------|
| **Basic** | 0.70 – 0.85 | Small rooms, 1 bathroom (shower only), basic kitchen, no extras |
| **Standard** | 0.85 – 1.00 | Average Belgian new build, 1-2 bathrooms, fitted kitchen |
| **Comfort** | 1.00 – 1.15 | Spacious rooms, 2 bathrooms (1 with bath), good kitchen, some extras |
| **Luxury** | 1.15 – 1.35 | Large rooms, dressing, 2+ bathrooms with high score, kitchen island, fireplace |
| **Premium** | 1.35 – 1.50 | Exceptional: wellness, 3+ bathrooms, huge entrance, top kitchen, generous terraces |
