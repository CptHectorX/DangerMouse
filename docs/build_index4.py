import re, sys

SRC = "roadmap.js"
with open(SRC, encoding="utf-8") as f:
    lines = f.read().split("\n")
if lines and lines[-1] == "":
    lines = lines[:-1]

# --- alten Index-Block (fuehrender /* ... */ Kommentar) entfernen ---
if lines and lines[0].lstrip().startswith("/*"):
    close = next((i for i, l in enumerate(lines) if "*/" in l), None)
    if close is not None:
        lines = lines[close + 1:]
        while lines and lines[0].strip() == "":
            lines = lines[1:]
body = lines

sections = [
    ("State / globale Variablen (Block 1)", r"^let state\b"),
    ("Undo/Redo-Historie",                 r"^function histInit\("),
    ("Boot, Datei laden/speichern, Export", r"^async function boot\("),
    ("View-Dispatch, Kopf, Sidebar, Toolbar", r"^function render\(\)"),
    ("Board-Ansicht: Karten, Timeline, DnD", r"^function orderedCards\("),
    ("Karten-Editor (Modal)",              r"^function openEditor\("),
    ("Hilfsfunktionen (Status, Escape, Markdown)", r"^function setStatus\("),
    ("Changelog & Dokumentation",          r"^function docCardMarkup\("),
    ("State / globale Variablen (Block 2)", r"^/\* =+\s*$"),
    ("Architektur: Daten, Rendering, Kanten", r"^function archData\("),
    ("Architektur: Auswahl, Copy/Paste",   r"^function archApplySelection\("),
    ("Architektur: DnD, Zoom, Editoren, Subnav", r"^function wireArchDnD\("),
    ("Moodboard: Daten, View, Elemente",   r"^function mbData\("),
    ("Moodboard: Verbindungen & Pfade",    r"^function drawMbConnections\("),
    ("Moodboard: Auswahl, Snapping, Gruppen", r"^function mbApplySelection\("),
    ("Moodboard: Text, Panel, Notizen",    r"^function mbCommitEdit\("),
    ("Moodboard: DnD, Resize, Zoom",       r"^function wireMbDnD\("),
    ("Moodboard: Subnav, Ordner, Sidebar-DnD", r"^function renderMbSubnav\("),
    ("Sync: 3-Wege-Merge (Basis, Objekt-Diff, Auto-Merge)", r"^const SV_BASE_KEY\b"),
    ("Persistenz (IndexedDB) & Bilder",    r"^function mbIdb\("),
    ("Bild einfuegen / aus URL laden",     r"^async function mbInsertImage\("),
    ("Event-Wiring: Toolbar, Shortcuts, Clipboard, Mittelklick-Guard, Sidebar-Resize", r"Mittelklick-Paste unterbinden"),
]

found = []
for label, pat in sections:
    rx = re.compile(pat)
    ln = next((i + 1 for i, l in enumerate(body) if rx.search(l)), None)
    if ln is None:
        print("MISS:", label); sys.exit(1)
    found.append([label, ln, pat])
found.sort(key=lambda t: t[1])

header = [
    "/* ============================================================",
    " *  StarVoyage - Mission Log  (roadmap.js)",
    " *  Datei-Navigation / Inhaltsverzeichnis - Zeilen zeigen auf den Abschnittsanfang.",
    " * ------------------------------------------------------------",
]
closing = [" * ============================================================ */", ""]
OFFSET = len(header) + len(found) + len(closing)
width = max(len(l) for l, _, _ in found)
entries = [f" *  {lbl.ljust(width)}  Zeile {ln + OFFSET}" for lbl, ln, _ in found]
block = header + entries + closing
assert len(block) == OFFSET, (len(block), OFFSET)

with open(SRC, "w", encoding="utf-8") as f:
    f.write("\n".join(block + body) + "\n")

# Selbstpruefung
with open(SRC, encoding="utf-8") as f:
    chk = f.read().split("\n")
ok = True
for lbl, ln, pat in found:
    claimed = ln + OFFSET
    if not re.search(pat, chk[claimed - 1] if claimed - 1 < len(chk) else ""):
        ok = False; print("FEHLER", claimed, lbl)
print("Selbstpruefung:", "ALLE KORREKT" if ok else "ABWEICHUNG")
print(f"{OFFSET} Index-Zeilen, {len(found)} Abschnitte")
sys.exit(0 if ok else 2)
