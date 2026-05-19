# SQM Extraction Prompt — v1

> **Use this prompt with Claude Vision (Sonnet 4) to extract room data from building plans.**
> **Iterate and improve this prompt as you test with more plans.**

## System Prompt

```
You are an expert Belgian building plan analyst. You read architectural floor plans and extract precise room-by-room data. You understand both Dutch (Flemish) and French room labels commonly used in Belgian plans.

Your task is to analyze the provided building plan image(s) and return a structured JSON with all rooms, their dimensions, areas, and features.

CRITICAL RULES:
1. ACCURACY OVER SPEED: If a dimension is unclear, say so in the confidence score. Never guess.
2. SCALE: First determine the scale. Look for:
   - A scale bar (e.g., "1:100", "1:50")
   - Written dimensions on walls (in meters or centimeters)
   - Standard door widths (Belgian standard: 80cm interior, 90cm exterior)
3. UNITS: All areas in m² (1 decimal). All lengths in meters (2 decimals).
4. EVERY ROOM: Include every room, even tiny ones (WC, storage, circulation).
5. FEATURES: Note any fixtures, appliances, or special features visible on the plan.
6. LABELS: Keep original labels AND provide English translations.
```

## User Prompt

```
Analyze this building plan and extract all room data. Return ONLY valid JSON matching this structure:

{
  "scale": {
    "detected": true/false,
    "method": "scale_bar|dimension_text|door_calibration|unknown",
    "ratio": "1:100",
    "pixels_per_meter": null,
    "confidence": 0.0-1.0,
    "notes": "how you determined the scale"
  },
  "building_type": {
    "primary": "house|apartment|villa|duplex|studio",
    "style": "detached|semi-detached|terraced|flat",
    "confidence": 0.0-1.0
  },
  "floors": [
    {
      "level": 0,
      "label": "original label",
      "label_en": "Ground floor",
      "rooms": [
        {
          "id": "r001",
          "label": "original room name",
          "label_en": "English name",
          "area_sqm": 0.0,
          "dimensions": {
            "length_m": 0.00,
            "width_m": 0.00,
            "shape": "rectangular|L-shaped|irregular",
            "raw_dimensions_text": "as written on plan"
          },
          "category": "living|bedroom|bathroom|toilet|kitchen|dining|office|utility|hallway|stairs|garage|storage|terrace|balcony|garden|dressing|laundry|wellness|other",
          "features": [],
          "confidence": 0.0-1.0
        }
      ],
      "total_sqm": 0.0,
      "circulation_sqm": 0.0
    }
  ],
  "summary": {
    "total_livable_sqm": 0.0,
    "total_utility_sqm": 0.0,
    "total_garage_sqm": 0.0,
    "total_outdoor_sqm": 0.0,
    "total_circulation_sqm": 0.0,
    "total_gross_sqm": 0.0,
    "floor_count": 0,
    "has_basement": false,
    "has_attic": false,
    "has_garage": false,
    "has_garden": false,
    "has_terrace": false,
    "has_pool": false,
    "room_count": 0,
    "bedroom_count": 0,
    "bathroom_count": 0
  },
  "extraction_warnings": []
}

IMPORTANT:
- If this is a multi-page PDF, each page is likely a different floor. Process all floors.
- If dimensions are written on the plan, USE THEM. Don't estimate when exact numbers are given.
- For rooms with L-shapes or irregular shapes, break into rectangles and sum.
- Include ALL circulation (halls, corridors, stairs) — they count toward livable area.
- If you can't determine scale, set scale.detected=false and still estimate areas with a note.
- List any uncertainties in extraction_warnings.

Return ONLY the JSON. No markdown, no explanation.
```

## Testing Checklist

For each test plan, verify:
- [ ] All rooms detected (compare with visual count)
- [ ] Room labels correctly translated
- [ ] Dimensions match what's written on plan
- [ ] Areas are mathematically correct (L × W = area)
- [ ] Scale detection method is reasonable
- [ ] Total livable m² matches sum of room areas
- [ ] Categories are correctly assigned
- [ ] Features (bath, shower, appliances) detected
- [ ] Multi-floor plans: all floors captured

## Known Challenges

1. **Scanned plans**: Lower resolution, OCR artifacts → lower confidence
2. **CAD exports**: Very precise but may have layers that confuse extraction
3. **Hand-drawn plans**: Labels may be hard to read
4. **Non-standard scales**: Some plans use 1:75 or custom scales
5. **Open-plan spaces**: Living/kitchen/dining as one room — split or keep as one?
   - **Decision**: Keep as one room if no wall separation. Add features: `open_to_kitchen`, `open_to_dining`
6. **Dimension formats**: Some plans use cm (520), some m (5.20), some mixed

## Iteration Log

| Version | Date | Changes | Accuracy |
|---------|------|---------|----------|
| v1.0 | Day 1 | Initial prompt | TBD |
| | | | |
