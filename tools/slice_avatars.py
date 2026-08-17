"""Slice the 55-headshot contact sheet into individual square avatars."""
import os
from PIL import Image

SRC = r"D:\downloads\DOC-20260816-WA0000.png"
OUT = r"C:\Users\Sakib Jawad\Desktop\Anti Grav\monkey-player\assets\avatars"

ROW_BANDS = [(4, 182), (189, 363), (369, 540), (547, 719), (727, 894)]
COL_BANDS = [(8, 154), (162, 313), (321, 464), (471, 618), (626, 765),
             (773, 914), (922, 1067), (1074, 1217), (1225, 1368), (1376, 1527)]
EXTRA_BAND = (900, 1021)
EXTRA_COLS = [(229, 413), (423, 619), (627, 831), (840, 1041), (1050, 1256)]

NAMES = [
    "Steve101", "DebraV", "TomB", "SarahJ", "JeffM", "LindaB", "MikeFromOhio",
    "Carol77", "Mark1972", "JennyL",
    "BillR", "NancyD", "TimW", "LisaAnn", "GregM", "KarenP", "JoeD",
    "AmandaK", "RickT", "CherylB",
    "ScottW", "CindyM", "FrankD", "DonnaR", "PeterJ", "TracyK", "RandyS",
    "JulieM", "MattB", "KevinP",
    "AngelaR", "DaveW", "BobT", "LauraJ", "ChrisM", "EricD", "TinaB",
    "GaryW", "SusanK", "BrianR",
    "CathyP", "RonM", "MelissaT", "AlexW", "DianeB", "TerryJ", "MonicaR",
    "JohnK", "KathyM", "PaulD",
    "MarcusT", "TanyaR", "DarnellJ", "OliviaS", "MiguelR",
]

# The name label is burned into the bottom of every cell; drop it before cropping.
LABEL_STRIP = 26
SIZE = 160

os.makedirs(OUT, exist_ok=True)
sheet = Image.open(SRC).convert("RGB")

cells = []
for (top, bottom) in ROW_BANDS:
    for (left, right) in COL_BANDS:
        cells.append((left, top, right, bottom))
for (left, right) in EXTRA_COLS:
    cells.append((left, EXTRA_BAND[0], right, EXTRA_BAND[1]))

assert len(cells) == len(NAMES), (len(cells), len(NAMES))

contact = Image.new("RGB", (SIZE * 10, SIZE * 6), "white")
for i, ((l, t, r, b), name) in enumerate(zip(cells, NAMES)):
    usable_bottom = b - LABEL_STRIP
    w = r - l + 1
    side = min(w, usable_bottom - t)
    cx = (l + r + 1) // 2
    x0 = cx - side // 2
    crop = sheet.crop((x0, t, x0 + side, t + side)).resize((SIZE, SIZE), Image.LANCZOS)
    crop.save(os.path.join(OUT, f"{name.lower()}.jpg"), quality=88, optimize=True)
    contact.paste(crop, ((i % 10) * SIZE, (i // 10) * SIZE))

contact.save(r"C:\Users\SAKIBJ~1\AppData\Local\Temp\claude\C--Users-Sakib-Jawad-Desktop-Anti-Grav\25a2e51c-6a35-4ced-8fd9-b125f94ea9b6\scratchpad\contact.png")
print(f"wrote {len(cells)} avatars")
