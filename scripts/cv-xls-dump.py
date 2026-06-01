# -*- coding: utf-8 -*-
"""Dump all sheets + cells from the old .xls files (beton + woningen)."""
import xlrd, os, sys

DIR = r"C:\Users\tieme\Mijn Drive\M²Value\connect value\Excel achter connect Value"

files = [
    "beton app voll eigen.xls",
    "woningen.xls",
]

for fname in files:
    path = os.path.join(DIR, fname)
    print("=" * 90)
    print(f"FILE: {fname}")
    try:
        wb = xlrd.open_workbook(path)
    except Exception as e:
        print(f"  ERROR: {e}")
        continue
    for sname in wb.sheet_names():
        ws = wb.sheet_by_name(sname)
        print(f"\n  ### SHEET: {sname!r}  rows={ws.nrows}  cols={ws.ncols}")
        for r in range(min(ws.nrows, 80)):
            cells = []
            for c in range(ws.ncols):
                v = ws.cell_value(r, c)
                if v in ("", None, 0, 0.0):
                    continue
                col = chr(65 + c) if c < 26 else chr(65 + c // 26 - 1) + chr(65 + c % 26)
                if isinstance(v, float) and v == int(v) and abs(v) < 1e10:
                    v = int(v)
                elif isinstance(v, float):
                    v = round(v, 4)
                s = str(v)
                if len(s) > 70:
                    s = s[:70] + "..."
                cells.append(f"{col}={s}")
            if cells:
                print(f"    {' | '.join(cells)}")
