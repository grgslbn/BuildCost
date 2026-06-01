# -*- coding: utf-8 -*-
"""Find base €/m² values in the 'vragen' master sheet.
Show header + all rows that carry a numeric value column, plus rows mentioning
woon/ingericht/inrichting/appartement to locate the apartment base price.
"""
import openpyxl, os

DIR = r"C:\Users\tieme\Mijn Drive\M²Value\connect value\Excel achter connect Value"
wb = openpyxl.load_workbook(os.path.join(DIR, "connect value bewerkt wat is de m2-prijs.xlsx"),
                            data_only=True, read_only=True)
ws = wb["vragen"]
rows = list(ws.iter_rows(values_only=True))
header = rows[0]
print("HEADER:")
for i, h in enumerate(header):
    if h not in (None, ""):
        print(f"  col{i} ({chr(65+i) if i<26 else 'A'+chr(65+i-26)}): {h!r}")
print("=" * 90)

# Print every row, marking numeric cells (candidate prices) and key text
KEY = ("woon", "ingericht", "inrichting", "appartement", "habitable", "bewoon")
for r in rows[1:]:
    if all(c in (None, "") for c in r):
        continue
    nums = [(i, c) for i, c in enumerate(r) if isinstance(c, (int, float)) and c not in (0, 1) and abs(c) > 1]
    txt = " ".join(str(c) for c in r if isinstance(c, str))
    has_key = any(k in txt.lower() for k in KEY)
    # Only print rows that have a candidate price > 50 OR mention a key term
    big = [(i, c) for i, c in nums if abs(c) >= 50]
    if big or has_key:
        cells = []
        for i, c in enumerate(r):
            if c in (None, ""):
                continue
            col = chr(65 + i) if i < 26 else "A" + chr(65 + i - 26)
            if isinstance(c, float):
                c = round(c, 2)
            s = str(c)
            if len(s) > 60:
                s = s[:60] + "…"
            cells.append(f"{col}={s}")
        print(" | ".join(cells))
wb.close()
