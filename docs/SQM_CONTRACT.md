# SQM Output Contract — WS1 → WS2

> **This is the integration interface between Tiemen (SQM Engine) and Georges (AI Pipeline).**
> **Both sides build to this spec. Changes require agreement from both.**

## Overview

WS1 produces this JSON for every uploaded plan. WS2 consumes it for QQP extraction and cost calculation.

The schema supports multi-building dossiers (common in Belgian insurance: apartment block + attached houses). Each building has per-floor totals with optional room-level subdivisions.

## Schema (v2.0 — Hybrid)

```json
{
  "plan_id": "uuid",
  "status": "success | partial | failed",
  "buildings": [
    {
      "id": "B1",
      "name": "Meergezinswoning",
      "type": "apartment_block | house | terraced_houses | commercial | mixed",
      "unit_count": 10,
      "floors": [
        {
          "level": 0,
          "label": "Gelijkvloers",
          "label_en": "Ground floor",
          "floor_total_sqm": 436.0,
          "terraces_sqm": 0.0,
          "zones": [
            {
              "zone_type": "residential",
              "description": "Appartementen 0.1-0.4",
              "area_sqm": 392.0,
              "rooms": [
                {
                  "label": "Woonkamer/keuken",
                  "category": "living",
                  "area_sqm": 28.2,
                  "features": ["open_to_kitchen", "large_window"]
                },
                {
                  "label": "Slaapkamer 1",
                  "category": "bedroom",
                  "area_sqm": 14.5
                },
                {
                  "label": "Badkamer",
                  "category": "bathroom",
                  "area_sqm": 6.8,
                  "features": ["shower", "single_sink"]
                }
              ]
            },
            {
              "zone_type": "circulation",
              "description": "Inkomhal, trappenhal, lifthal, gangen",
              "area_sqm": 44.0
            }
          ]
        },
        {
          "level": -1,
          "label": "Kelder",
          "label_en": "Basement",
          "floor_total_sqm": 747.0,
          "terraces_sqm": 0.0,
          "zones": [
            {
              "zone_type": "parking",
              "description": "Parkeergarage P1-P15 incl. rijbaan en inrit",
              "area_sqm": 520.0
            },
            {
              "zone_type": "storage",
              "description": "Kelderbergingen B01-B10",
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
          ]
        }
      ],
      "building_totals": {
        "enclosed_sqm": 1856.0,
        "terraces_sqm": 131.0,
        "underground_sqm": 747.0,
        "aboveground_sqm": 1109.0
      },
      "summary": {
        "bedroom_count": 12,
        "bathroom_count": 10,
        "has_elevator": true,
        "elevator_count": 1,
        "has_garage": true,
        "has_basement": true
      },
      "infrastructure": [
        {
          "type": "elevator",
          "description": "1 lift met 4 stopplaatsen",
          "quantity": 1
        }
      ]
    }
  ],
  "project_totals": {
    "total_enclosed_sqm": 2310.0,
    "total_terraces_sqm": 131.0,
    "total_underground_sqm": 747.0,
    "total_aboveground_sqm": 1563.0,
    "building_count": 2
  },
  "extraction_metadata": {
    "model_used": "claude-sonnet-4-20250514",
    "processing_time_ms": 4200,
    "prompt_version": "v3",
    "source_format": "pdf | image",
    "source_pages": 4,
    "extraction_warnings": [
      "Floor 2 terrace/enclosed split estimated — line thickness ambiguous at this resolution"
    ]
  }
}
```

## Key Rules

### Hierarchy: Building → Floor → Zone → Room

1. **`buildings[]`** — one entry per structurally independent building in the dossier
2. **`floors[]`** — one entry per level, ordered by level number
3. **`zones[]`** — one entry per functional zone on a floor (residential, parking, etc.)
4. **`rooms[]`** — **optional** array inside a zone, present only when room-level labels are visible on the plan

### Floor Totals Are Authoritative

- `floor_total_sqm` = sum of all `zones[].area_sqm` on that floor (excluding terraces)
- Room sums may NOT equal zone total — rooms use net area (vloeroppervlakte), zones use bruto (includes walls)
- WS2 uses `floor_total_sqm` for cost calculation, `rooms[]` for QQP discovery

### Terraces Separate

- `terraces_sqm` tracked per floor, NOT in the zones array
- Different reconstruction value than enclosed space
- Belgian stepped buildings: upper floor terraces = roof of floor below

### Room-Level Detail

When vision can read room labels on plans (e.g., "slaapkamer 1  11.7 m²"), include them in `rooms[]`. When it can't (parking garages, kelders, technical zones), the zone stands alone without rooms.

Room areas are **vloeroppervlakte** (net, wall-to-wall interior). To estimate bruto from net rooms: total net × 1.15–1.20 ≈ zone bruto.

## Zone Types

Use these exact values for `zone_type`:

| Zone Type | Description | Examples |
|-----------|-------------|----------|
| `residential` | Private living space | Apartments, houses, individual units |
| `parking` | Vehicle storage + lanes | Garage, parkeerplaatsen, inrit/oprit |
| `storage` | Storage rooms | Bergingen, kelderberging, zolderberging |
| `technical` | Building services | Tellerlokaal, stookplaats, liftput, watergroep |
| `circulation` | Shared access | Gang, trappenhal, lifthal, inkomhal |
| `bike_storage` | Bicycle storage | Fietsenstalling, fietsberging |
| `commercial` | Non-residential use | Winkels, kantoren |
| `other` | Anything else | — |

## Room Categories

Use these exact values for `category` in `rooms[]`:

| Category | Description | Examples |
|----------|-------------|----------|
| `living` | Main living spaces | Woonkamer, leefruimte, salon, séjour |
| `bedroom` | Sleeping rooms | Slaapkamer, chambre |
| `bathroom` | Wet rooms with bath/shower | Badkamer, salle de bain |
| `toilet` | WC only | Toilet, WC |
| `kitchen` | Cooking areas | Keuken, cuisine |
| `dining` | Dedicated eating areas | Eetkamer, salle à manger |
| `office` | Work rooms | Bureau, kantoor |
| `utility` | Functional rooms | Berging, buanderie, wasruimte |
| `hallway` | Circulation within unit | Gang, hal, entrée |
| `dressing` | Walk-in closet | Dressing, inloopkast |
| `laundry` | Dedicated laundry | Wasplaats |
| `other` | Anything else | — |

## Feature Tags

Non-exhaustive list. WS1 extracts any it detects at room level:

**Bathroom**: `bath`, `shower`, `double_sink`, `single_sink`, `bidet`, `jacuzzi`, `heated_floor`
**Kitchen**: `island`, `open_plan`, `built_in_oven`, `built_in_dishwasher`, `built_in_fridge`, `built_in_microwave`, `built_in_steamer`, `wine_fridge`
**Living**: `fireplace`, `open_to_kitchen`, `open_to_dining`, `large_window`, `double_height`, `mezzanine`
**General**: `skylight`, `bay_window`, `french_doors`, `sliding_doors`, `built_in_storage`
**Materials** (if visible): `parquet`, `tiles`, `marble`, `natural_stone`

## Extraction Metadata

- `model_used`: Claude model ID
- `prompt_version`: version of the extraction prompt (e.g., "v3")
- `processing_time_ms`: total API call time
- `extraction_warnings`: array of strings for anything uncertain

## Versioning

| Version | Date | Changes |
|---------|------|---------|
| v1.0 | 2026-05-19 | Initial — single building, room-level only |
| v2.0 | 2026-05-19 | Hybrid: multi-building, zone-level floors with optional room detail, terraces separate, infrastructure |
