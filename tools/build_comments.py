"""Export the 40 comment sets + commenter roster from the workbook into editable JS."""
import json
import re
import unicodedata

import openpyxl

SRC = r"D:\downloads\40_Synchronized_Monkey_Comment_Sets_Gender_Neutral (1).xlsx"
OUT = r"C:\Users\Sakib Jawad\Desktop\Anti Grav\monkey-player\data\comment-sets.js"

# Codepoints that count as part of an emoji run in the workbook's Emoji column.
EMOJI_RE = re.compile(
    "^(?:[\U0001F000-\U0001FAFF\u2190-\u21FF\u2300-\u27BF\u2B00-\u2BFF"
    "\uFE0F\u200D\U0001F3FB-\U0001F3FF\u20E3\u00A9\u00AE\\s])+"
)


def split_emoji(cell):
    """Return (emoji, note). The column mixes glyphs with stage directions and a URL."""
    if not cell:
        return None, None
    raw = str(cell).strip()
    m = EMOJI_RE.match(raw)
    emoji = (m.group(0).strip() if m else "")
    note = raw[len(m.group(0)):].strip() if m else raw
    if note == "...":  # the sheet's "\uD83D\uDC40..." trail-off is part of the reaction
        emoji, note = emoji + "...", ""
    return (emoji or None), (note or None)


def slug(name):
    return re.sub(r"[^a-z0-9]+", "", name.lower())


wb = openpyxl.load_workbook(SRC)

roster = []
for row in wb["Commenter Roster"].iter_rows(min_row=2, values_only=True):
    if not row[0]:
        continue
    roster.append({"id": slug(row[0]), "name": row[0].strip(),
                   "personality": (row[1] or "").strip(),
                   "avatar": f"assets/avatars/{slug(row[0])}.jpg"})

sets = []
for sheet in wb.sheetnames:
    if not sheet.startswith("Set "):
        continue
    comments = []
    for row in wb[sheet].iter_rows(min_row=2, values_only=True):
        if not row[0]:
            continue
        t = int(str(row[0]).strip().rstrip("sS"))
        emoji, note = split_emoji(row[5])
        text = unicodedata.normalize("NFC", str(row[4]).strip()) if row[4] else ""
        c = {"t": t, "who": slug(row[1]), "target": (row[3] or "").strip(), "text": text}
        if emoji:
            c["emoji"] = emoji
        if note:
            c["note"] = note
        comments.append(c)
    comments.sort(key=lambda c: c["t"])
    sets.append({"id": slug(sheet), "label": sheet.replace(" - Current", ""),
                 "comments": comments})

assert len(sets) == 40, len(sets)
known = {r["id"] for r in roster}
missing = {c["who"] for s in sets for c in s["comments"]} - known
assert not missing, missing

lines = [
    "// Comment data for the Dynamic Monkey Video Player.",
    "// Generated from `40_Synchronized_Monkey_Comment_Sets_Gender_Neutral.xlsx`, then",
    "// hand-editable: change `text`, `emoji` or `t` (seconds into the 44s video) freely.",
    "// `note` carries a stage direction from the source sheet that had no emoji glyph.",
    "",
    "export const COMMENTERS = " + json.dumps(roster, ensure_ascii=False, indent=2) + ";",
    "",
    "export const COMMENT_SETS = [",
]
for s in sets:
    lines.append(f"  {{")
    lines.append(f"    id: {json.dumps(s['id'])},")
    lines.append(f"    label: {json.dumps(s['label'], ensure_ascii=False)},")
    lines.append(f"    comments: [")
    for c in s["comments"]:
        lines.append("      " + json.dumps(c, ensure_ascii=False) + ",")
    lines.append("    ],")
    lines.append("  },")
lines.append("];")
lines.append("")

with open(OUT, "w", encoding="utf-8") as fh:
    fh.write("\n".join(lines))

print("sets:", len(sets), "comments:", sum(len(s["comments"]) for s in sets))
print("roster:", len(roster))
print("notes kept:", sum(1 for s in sets for c in s["comments"] if "note" in c))
