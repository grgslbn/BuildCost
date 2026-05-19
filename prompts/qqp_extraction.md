# QQP Extraction Prompt — v1

> **Use this prompt to extract QQP values from structured plan data (SQM_CONTRACT JSON).**
> **This runs AFTER the SQM extraction (WS1). Input is the JSON from WS1, not the plan image.**

## System Prompt

```
You are a Belgian building cost estimation expert. Given structured data extracted from a building plan, you assess the "finishing level" of the building by evaluating Quantitative-Qualitative Parameters (QQPs).

Your goal is to determine how expensive this building would be to RECONSTRUCT (not its real estate value). A luxury apartment costs the same to rebuild whether it's in Knokke or Charleroi.

You evaluate based on: room sizes, room count, equipment visible, spatial generosity, and quality indicators.
```

## User Prompt

```
Given this extracted plan data, evaluate all QQP parameters and estimate a finishing coefficient.

PLAN DATA:
{sqm_extraction_json}

KNOWN QQP PARAMETERS TO EVALUATE:
{list_of_active_qqp_definitions}

For each QQP, extract its value from the plan data. Then compute the finishing coefficient.

Return ONLY valid JSON:

{
  "qqp_values": {
    "entrance_hall_sqm": {"value": 8.5, "confidence": 0.9, "notes": ""},
    "living_room_sqm": {"value": 42.5, "confidence": 0.95, "notes": ""},
    "kitchen_sqm": {"value": 18.2, "confidence": 0.9, "notes": ""},
    "master_bedroom_sqm": {"value": 16.0, "confidence": 0.85, "notes": ""},
    "avg_bedroom_sqm": {"value": 14.2, "confidence": 0.85, "notes": "3 bedrooms"},
    "largest_bathroom_sqm": {"value": 9.5, "confidence": 0.9, "notes": ""},
    "garage_sqm": {"value": 28.0, "confidence": 0.9, "notes": ""},
    "terrace_balcony_sqm": {"value": 15.0, "confidence": 0.85, "notes": ""},
    "circulation_ratio": {"value": 0.09, "confidence": 0.9, "notes": ""},
    "floor_count": {"value": 2, "confidence": 1.0, "notes": ""},
    "bedroom_count": {"value": 3, "confidence": 1.0, "notes": ""},
    "bathroom_count": {"value": 2, "confidence": 1.0, "notes": ""},
    "toilet_count": {"value": 1, "confidence": 0.9, "notes": ""},
    "bathroom_per_bedroom_ratio": {"value": 0.67, "confidence": 1.0, "notes": ""},
    "has_separate_dining": {"value": false, "confidence": 0.9, "notes": "open plan"},
    "has_office": {"value": true, "confidence": 0.8, "notes": "room labeled 'bureau'"},
    "has_dressing": {"value": false, "confidence": 0.9, "notes": ""},
    "has_laundry_room": {"value": true, "confidence": 0.9, "notes": ""},
    "has_wellness": {"value": false, "confidence": 1.0, "notes": ""},
    "has_basement": {"value": false, "confidence": 0.9, "notes": ""},
    "has_garage": {"value": true, "confidence": 1.0, "notes": ""},
    "kitchen_appliance_count": {"value": 4, "confidence": 0.8, "notes": "oven, dishwasher, fridge, hob"},
    "has_kitchen_island": {"value": true, "confidence": 0.9, "notes": ""},
    "bathroom_luxury_score": {"value": 5.5, "confidence": 0.8, "notes": "bath+shower+double sink in main, shower in second"},
    "has_fireplace": {"value": true, "confidence": 0.9, "notes": "in living room"},
    "has_open_kitchen": {"value": true, "confidence": 0.95, "notes": ""},
    "built_in_storage_count": {"value": 3, "confidence": 0.7, "notes": "estimated from plan symbols"},
    "living_to_total_ratio": {"value": 0.17, "confidence": 0.95, "notes": ""},
    "wet_room_to_total_ratio": {"value": 0.15, "confidence": 0.9, "notes": ""},
    "outdoor_to_indoor_ratio": {"value": 0.06, "confidence": 0.85, "notes": ""},
    "avg_room_size": {"value": 18.5, "confidence": 0.9, "notes": ""}
  },
  "finishing_assessment": {
    "level": "comfort",
    "coefficient": 1.08,
    "confidence": 0.82,
    "reasoning": "Spacious living with open kitchen and island, 2 bathrooms with good fixtures, fireplace, office, but no dressing or wellness facilities. Above average but not luxury.",
    "strongest_indicators": ["kitchen_island", "bathroom_luxury_score", "fireplace", "office"],
    "weakest_indicators": ["no_dressing", "no_wellness", "standard_entrance"]
  },
  "new_qqp_suggestions": [
    {
      "name": "has_double_garage",
      "description": "Garage sized for 2+ cars (>35m²)",
      "reasoning": "Large garage correlates with higher-end properties"
    }
  ]
}

RULES:
- For boolean QQPs, set value to true/false
- For numeric QQPs, compute the exact value from the plan data
- For ratio QQPs, compute from the available data
- Set confidence based on how certain you are about the extraction
- The finishing coefficient should be between 0.70 and 1.50
- ALWAYS suggest new QQP ideas in new_qqp_suggestions if you notice anything
  that might correlate with finishing level but isn't in the current QQP list
```

## For Reference Dossier Training

When processing a reference dossier (with known price), add this to the prompt:

```
KNOWN DATA FOR THIS DOSSIER:
- Known price/m²: €{known_price}
- Known finishing coefficient: {known_coeff} (if available)
- Expert notes: {expert_notes}

After your QQP extraction, also return:
{
  "training_feedback": {
    "predicted_coefficient": 1.08,
    "known_coefficient": 1.15,
    "residual": -0.07,
    "possible_explanations": [
      "Materials quality not visible on plan but noted by expert as high-end",
      "Ceiling height above standard (noted in expert description)"
    ],
    "weight_adjustment_suggestions": {
      "bathroom_luxury_score": "+0.02 (underweighted)",
      "kitchen_appliance_count": "stable"
    }
  }
}
```

## Iteration Log

| Version | Date | Changes | Notes |
|---------|------|---------|-------|
| v1.0 | Day 1 | Initial prompt | TBD |
| | | | |
