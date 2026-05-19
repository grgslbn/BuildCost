# SQM Output Contract — WS1 → WS2

> **This is the integration interface between Tiemen (SQM Engine) and Georges (AI Pipeline).**
> **Both sides build to this spec. Changes require agreement from both.**

## Overview

WS1 produces this JSON for every uploaded plan. WS2 consumes it for QQP extraction and cost calculation.

## Schema

```json
{
  "plan_id": "uuid",
  "status": "success | partial | failed",
  "scale": {
    "detected": true,
    "method": "scale_bar | dimension_text | door_calibration | user_input",
    "pixels_per_meter": 142.5,
    "confidence": 0.92,
    "notes": "Scale bar found: 1:100"
  },
  "building_type": {
    "primary": "house | apartment | villa | duplex | studio | commercial | mixed",
    "style": "detached | semi-detached | terraced | flat",
    "confidence": 0.88
  },
  "floors": [
    {
      "level": 0,
      "label": "Gelijkvloers",
      "label_en": "Ground floor",
      "source_page": 1,
      "rooms": [
        {
          "id": "r001",
          "label": "Leefruimte",
          "label_en": "Living room",
          "area_sqm": 42.5,
          "dimensions": {
            "length_m": 8.5,
            "width_m": 5.0,
            "shape": "rectangular | L-shaped | irregular",
            "raw_dimensions_text": "8.50 x 5.00"
          },
          "category": "living",
          "features": [
            "fireplace",
            "large_window",
            "open_to_kitchen"
          ],
          "confidence": 0.92
        },
        {
          "id": "r002",
          "label": "Keuken",
          "label_en": "Kitchen",
          "area_sqm": 18.2,
          "dimensions": {
            "length_m": 5.2,
            "width_m": 3.5,
            "shape": "rectangular",
            "raw_dimensions_text": "5.20 x 3.50"
          },
          "category": "kitchen",
          "features": [
            "island",
            "built_in_oven",
            "built_in_dishwasher",
            "built_in_fridge"
          ],
          "confidence": 0.89
        }
      ],
      "total_sqm": 145.3,
      "circulation_sqm": 12.4
    }
  ],
  "summary": {
    "total_livable_sqm": 245.6,
    "total_utility_sqm": 35.2,
    "total_garage_sqm": 28.0,
    "total_outdoor_sqm": 15.0,
    "total_circulation_sqm": 22.8,
    "total_gross_sqm": 308.8,
    "floor_count": 2,
    "has_basement": false,
    "has_attic": true,
    "has_garage": true,
    "has_garden": true,
    "has_terrace": true,
    "has_pool": false,
    "room_count": 12,
    "bedroom_count": 3,
    "bathroom_count": 2
  },
  "extraction_metadata": {
    "model_used": "claude-sonnet-4-6",
    "processing_time_ms": 4200,
    "source_format": "pdf | image | cad",
    "source_pages": 3,
    "extraction_warnings": [
      "Floor 2 dimensions partially illegible — lower confidence"
    ]
  }
}
```

## Room Categories

Use these exact values for `category`:

| Category | Description | Examples |
|----------|-------------|----------|
| `living` | Main living spaces | Living room, salon, séjour |
| `bedroom` | Sleeping rooms | Slaapkamer, chambre |
| `bathroom` | Wet rooms with bath/shower | Badkamer, salle de bain |
| `toilet` | WC only | Toilet, WC |
| `kitchen` | Cooking areas | Keuken, cuisine |
| `dining` | Dedicated eating areas | Eetkamer, salle à manger |
| `office` | Work rooms | Bureau, kantoor |
| `utility` | Functional rooms | Berging, buanderie, wasruimte |
| `hallway` | Circulation | Gang, hal, entrée, couloir |
| `stairs` | Stairwells | Trap, escalier |
| `garage` | Vehicle storage | Garage |
| `storage` | Storage rooms | Kelder, cave, zolder (if storage) |
| `terrace` | Outdoor covered | Terras, terrasse |
| `balcony` | Elevated outdoor | Balkon, balcon |
| `garden` | Outdoor uncovered | Tuin, jardin |
| `dressing` | Walk-in closet | Dressing, inloopkast |
| `laundry` | Dedicated laundry | Wasplaats |
| `wellness` | Spa, sauna, pool room | Wellness, sauna |
| `other` | Anything else | — |

## Feature Tags

Non-exhaustive list of recognized features. WS1 should extract any it detects:

**Bathroom features**: `bath`, `shower`, `double_sink`, `single_sink`, `bidet`, `jacuzzi`, `heated_floor`
**Kitchen features**: `island`, `open_plan`, `built_in_oven`, `built_in_dishwasher`, `built_in_fridge`, `built_in_microwave`, `built_in_steamer`, `wine_fridge`
**Living features**: `fireplace`, `open_to_kitchen`, `open_to_dining`, `large_window`, `double_height`, `mezzanine`
**General**: `skylight`, `bay_window`, `french_doors`, `sliding_doors`, `built_in_storage`, `walk_in_closet`
**Materials** (if visible on plan): `parquet`, `tiles`, `marble`, `natural_stone`, `hardwood`
**Outdoor**: `covered`, `uncovered`, `bbq_area`, `pool`, `hot_tub`

## Confidence Scoring

- `0.90–1.00`: High confidence — clear dimensions, legible labels
- `0.70–0.89`: Medium — some inference required (e.g., dimension from scale, label guessed)
- `0.50–0.69`: Low — significant estimation (irregular room, poor scan quality)
- `< 0.50`: Flag for manual review

## Rules

1. All areas in **square meters** (m²), rounded to 1 decimal
2. All linear dimensions in **meters**, rounded to 2 decimals
3. `total_livable_sqm` = sum of all rooms EXCEPT garage, outdoor, storage, stairs
4. `total_gross_sqm` = sum of ALL rooms including garage and outdoor
5. `circulation_sqm` = hallways + stairs (subset of livable, but tracked separately)
6. If a room spans multiple floors (double height), count area on the lower floor only
7. If scale cannot be determined, set `scale.detected = false` and areas to `null`
8. Always include `extraction_warnings` for anything uncertain

## Versioning

- **v1.0** — Initial contract (hackathon)
- Changes require updating this file AND notifying the other workstream
