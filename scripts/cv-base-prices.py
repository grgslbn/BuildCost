# -*- coding: utf-8 -*-
"""Reconstruct Connect Value BASE €/m² per category from the component build-up.
Each category (col A) is a sum of component rows. col F = €/m² at current ABEX,
col G = €/m² at ABEX 819 (reference). Vraagsoort (col E):
  'onzichtbaar' = always-on base component
  'ja / nee'    = optional add-on (only if answered yes)
  other         = multiple-choice / linked
We sum the always-on base and list optional add-ons separately.
"""
import openpyxl, os
from collections import defaultdict

DIR = r"C:\Users\tieme\Mijn Drive\M²Value\connect value\Excel achter connect Value"
wb = openpyxl.load_workbook(os.path.join(DIR, "connect value bewerkt wat is de m2-prijs.xlsx"),
                            data_only=True, read_only=True)
ws = wb["vragen"]
rows = list(ws.iter_rows(values_only=True))[1:]

# cols: 0 Categorie, 3 Vraag, 4 Vraagsoort, 5 coeff(current), 6 coeff(ABEX819)
cats = defaultdict(list)
for r in rows:
    cat = r[0]
    if not cat:
        continue
    vraag = r[3]
    soort = (r[4] or "").strip().lower()
    fcur = r[5] if isinstance(r[5], (int, float)) else None
    fabex = r[6] if isinstance(r[6], (int, float)) else None
    cats[cat].append((vraag, soort, fcur, fabex))

# focus categories for the apartment building (owner)
FOCUS = [
    "Appartementsgebouw - Eigenaar - Deel appartementen",
    "Appartementsgebouw - Eigenaar - Deel terrassen",
    "Appartementsgebouw - Eigenaar - Deel kelders en garages",
    "Appartementsgebouw - Eigenaar - Deel handelsgelijkvloers",
    "Woning - Eigenaar - Ingerichte ruimtes",
    "Woning - Eigenaar - Niet ingerichte ruimtes",
]

def summarize(cat):
    comps = cats.get(cat)
    if not comps:
        # try fuzzy
        matches = [c for c in cats if cat.lower() in c.lower()]
        if matches:
            cat = matches[0]; comps = cats[cat]
        else:
            print(f"  (niet gevonden: {cat})"); return
    base_cur = sum(c[2] for c in comps if c[1] == "onzichtbaar" and c[2])
    base_abex = sum(c[3] for c in comps if c[1] == "onzichtbaar" and c[3])
    print(f"\n### {cat}")
    print(f"  BASIS (altijd, 'onzichtbaar'): €{base_cur:.0f}/m² (huidige ABEX)  |  €{base_abex:.0f}/m² (ABEX 819)")
    print(f"  componenten ({len([c for c in comps if c[1]=='onzichtbaar'])} altijd-aan):")
    for v, s, fc, fa in comps:
        if s == "onzichtbaar" and fc:
            print(f"     {v[:48]:48s} €{fc:.0f}")
    opt = [(v, s, fc) for v, s, fc, fa in comps if s != "onzichtbaar" and fc]
    if opt:
        print(f"  optionele/keuze add-ons:")
        for v, s, fc in opt:
            print(f"     [{s}] {v[:44]:44s} +€{fc:.0f}")

for f in FOCUS:
    summarize(f)

print("\n" + "=" * 90)
print("ALLE categorieën met hun BASIS-som (altijd-aan componenten), huidige ABEX:")
agg = []
for cat, comps in cats.items():
    base = sum(c[2] for c in comps if c[1] == "onzichtbaar" and c[2])
    if base > 0:
        agg.append((base, cat))
for base, cat in sorted(agg, reverse=True):
    print(f"  €{base:6.0f}/m²   {cat}")
wb.close()
