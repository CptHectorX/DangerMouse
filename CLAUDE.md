# DangerMouse — Projektkontext für Claude Code

## Jam-Modus: Claude committet und pusht selbst
Für dieses Jam-Repo gilt: Claude darf `git add` / `commit` / `push` **selbst absetzen** —
Tempo geht vor Kontrolle. Zwei Einschränkungen bleiben:
- **Vor dem Push kurz sagen, was drin ist** (ein Satz reicht).
- Bei **irreversiblen** Aktionen weiterhin **erst fragen**: `reset --hard`, `push --force`,
  Verwerfen fremder Commits, Löschen von Dateien, die nicht von dir stammen.

## Code- und Commit-Stil
- **Keine Kommentare im Spielcode.** Godot-Code (`.gd`, `.tscn`-Skripte) wird ohne
  Kommentare geschrieben — sprechende Namen statt Erklärtext. **Ausnahme: das Werkzeug in
  `docs/`.** Dort bleiben Kommentare, insbesondere der Navigations-Index oben in
  `roadmap.js` — den erzeugt und prüft `build_index4.py`, ohne ihn bricht der Pflicht-Check.
- **Commit-Messages:** Englisch, knapp, Imperativ (`Add inventory slot handling`).
  **Keine Trailer, keine Signaturen** — kein `Co-Authored-By`, kein `Generated with`,
  keine Werkzeug-Hinweise. Nur die Nachricht selbst.

## ⚠️ Dieses Repo ist ÖFFENTLICH
`github.com/CptHectorX/DangerMouse` ist ein **public** Repo. Niemals Tokens, PATs,
Cloudflare-IDs, E-Mail-Adressen oder Zugangsdaten in Dateien schreiben — auch nicht
beispielhaft, auch nicht auskommentiert. Secrets leben ausschließlich als Env-Vars im
Cloudflare-Pages-Projekt. Im Zweifel nachfragen.

## Rahmen: Game Jam Augsburg
Zwei Leute (Alex + Juli), Wochenende, **Abgabe Sonntag**. Danach wird das Repo gelöscht.
Das heißt für jede Entscheidung: **der kürzeste Weg, der funktioniert**. Keine Architektur
auf Zuwachs, keine Abstraktionen für später — später gibt es nicht. Wenn eine saubere
Lösung eine Stunde und eine pragmatische zehn Minuten kostet, nimm die zehn Minuten und
sag dazu, was der Preis ist.

## Branch-Kontext
Ein Repo, **ein Branch: `main`**. Kein Branchwechsel, kein zweiter Kontext — anders als im
StarVoyage-Repo, aus dem dieses hier kopiert wurde. Falls dir StarVoyage-Reste auffallen
(Verweise auf SpaceAct, `game/`, `Gosehawk-Software`, Spritesheets, Starsector-Assets):
melden, nicht stillschweigend anpassen.

## Was ist das hier
Godot-4-Spiel **DangerMouse** (Repo-Root, `project.godot`) **plus** das mitgebrachte
Web-Werkzeug in `docs/`: das **Board** (Karten, Changelog, Doku, Architektur, Moodboard).
Läuft online auf Cloudflare Pages, beide arbeiten parallel daran (siehe **Sync**).

### Das Spiel — noch offen
Das Spielkonzept steht bei Anlage dieser Datei **noch nicht fest** (der ursprünglich
geplante Point-&-Click wurde verworfen). Dieser Abschnitt wird gefüllt, sobald das Konzept
steht: Genre, Steuerung, Szenen-/Skript-Struktur, Asset-Pfade, Renderer. Bis dahin nichts
über den Aufbau des Spiels annehmen — im Board nachsehen oder fragen.

- **Starten:** `bash run.sh` (findet `godot-4` via PATH/Snap, sonst ein Binary in
  `~/Downloads`); `--editor` öffnet im Editor. **Die Startskripte haben kein Ausführ-Recht**
  — `./run.sh` scheitert mit „Keine Berechtigung", deshalb `bash` davor.
- **Zielplattform:** entwickelt und gespielt auf einem **MacBook M1**; Abgabe als
  **Web-Export auf itch.io**.
- **Renderer: GL Compatibility — fest.** Der Web-Export ist damit verlässlich; Forward+
  setzt im Browser WebGPU voraus. Nicht ohne Rücksprache umstellen.
- **Web-Export früh testen, nicht am Ende.** Browser-Builds decken Dinge auf, die im Editor
  nie auffallen (Audio-Autoplay, Dateizugriffe, Threads). Auf itch.io muss beim Upload die
  SharedArrayBuffer-Option gesetzt sein, sonst hängt das Spiel im Ladebalken.

## Zusammenarbeit
- Kommunikation auf **Deutsch**; **Code und Commit-Messages auf Englisch.**
- **Root-Cause-Fixes statt Patches** — die Ursache beheben, nicht drumherum flicken.
- **Erst kurz erklären**, *was* geändert wird und *warum*, dann umsetzen. Bei größeren
  Aufgaben erst einen **Plan** zeigen.
- Bei Unklarheit, mehreren Wegen oder Risiko **nachfragen statt raten**. Bin ich kurz weg:
  „so gut wie möglich" umsetzen und offene Punkte klar markieren.
- Nach einer Änderung kurz sagen, **was gemacht wurde** und **was ich testen soll**.
- Ehrliche Unsicherheit statt selbstsicher klingender Vermutungen. Direkt und knapp,
  freundlicher Ton; sorgfältig statt hastig. Nie ein laufendes System kaputt machen.
- Bei gelieferten Dateien (v. a. `roadmap.js`) **Prüfsumme + Verifikations-Befehl mitgeben**
  (`sha256sum`, `grep -c <Anker>`), damit Verwechslungen sofort auffallen.
- Befehls-Blöcke fürs Terminal **ohne eingestreute Anleitungs-Kommentare** — sie werden
  komplett kopiert.
- **Zwei Leute am selben Repo:** vor Arbeitsbeginn `git pull`. Was Juli gerade anfasst,
  nicht parallel umbauen.

## Ticket-Workflow (pro Karte)
**Regel: Kein `done` ohne Changelog-Eintrag und Umsetzungs-Notiz an der Karte.**

1. **Ticket holen** — Karte lesen (Titel, Status, Tags, Notiz — die Notiz enthält oft schon
   Fragen oder Entscheidungen).
2. **Evtl. Rückfragen** — nachfragen statt raten (s. o.).
3. **Ticket ergänzen** — Entscheidungen in die Karten-Notiz; **Original-Text erhalten**,
   Ergänzung abtrennen (z. B. `--- Umgesetzt <Datum> (bitte testen) ---`).
4. **Ticket ausführen.**
5. **Changelog updaten** — Eintrag oben einfügen, ID-Schema `cl-dm-NN`, `rev` = neue
   Revision, `meta.revision` **+1**, `meta.updated` = heute, Karte auf `done` + `date`.
   **Erst dokumentieren, dann schließen.**
6. **Index checken** — Pflicht nach jeder `roadmap.js`-Änderung (siehe unten).

Es gibt genau **einen Act**: `DangerMouse` (`id: dangermouse`), Kartenschlüssel-Kürzel
**`DM`** (DM-001, DM-002 …), Zähler `nextNum` läuft nur vorwärts. Phasen: Tag 1 / 2 / 3.

## Das Werkzeug in docs/ — Architektur
Reine **vanilla-JS-Web-App, keine Frameworks**:
- `roadmap.html` — Gerüst (Sidebar, Views, Modals, Toolbar inkl. „Verwerfen", Status-Panel).
- `roadmap.css` — Styling; Farben über `[data-theme]`-Tokens am `<body>`.
- `roadmap.js` — die gesamte Logik. **Oben ein Navigations-Index** (Kommentarblock,
  Abschnitt→Zeile, aktuell 22 Abschnitte).
- `roadmap.json` — die **einzige Wahrheit**: `meta` + `acts[]`. Der Act hat
  `phases, columns, cards, changelog, docs, architecture, moodboard`. Alle Objekte tragen
  stabile `id`s — darauf baut der 3-Wege-Merge auf.
- `functions/api/save.js` — Pages Function: committet `roadmap.json` (POST, Revision-Guard).
- `functions/api/state.js` — Pages Function: liefert die Repo-frische `roadmap.json` (GET;
  bewusst NICHT `roadmap.js` genannt — ein Dateinamens-Unfall hatte die Function einmal
  mit der App-Datei überschrieben).
- `functions/api/image.js` — Pages Function: committet Moodboard-Bilder nach `docs/images/`
  (POST, Schema `mb-*.png`, `[CI Skip]` im Commit → kein eigener Deploy).
- `_redirects` — leitet `/` auf `roadmap.html`. `_headers` — `no-cache` für
  `roadmap.html/.js/.css`: nach jedem Deploy läuft sofort die neue Version.
- `.gdignore` — hält Godot aus `docs/` raus. Nicht löschen.
- `start.sh` — Legacy: lokaler Launcher aus der Vor-Online-Zeit, wird nicht genutzt.

## Nach JS-Änderungen (Pflicht)
Beide Schritte im `docs/`-Ordner, immer:
1. `node --check roadmap.js` — muss fehlerfrei durchlaufen.
2. `python3 build_index4.py` — baut den Navigations-Index oben in `roadmap.js` neu
   (Zeilennummern verschieben sich bei jeder Änderung) und **prüft sich selbst**: Die
   Ausgabe muss **„ALLE KORREKT"** enthalten. Muss **vor** dem Commit laufen.

**Wartungs-Stolperstelle:** Das Skript kennt die Abschnitts-Anker **fest** (Regex-Liste oben
in `build_index4.py`). Ein **neuer großer Code-Abschnitt** braucht dort einen neuen Anker,
sonst schlägt die Selbstprüfung an.

## Betrieb: Online (Cloudflare Pages)
Deploy-Quelle ist dieses GitHub-Repo, **Root directory `docs/`**, kein Build-Schritt.
**Auto-Deploy** bei jedem Push (~1 Min); auch Online-Saves erzeugen Commits.
Zugriffsschutz über Cloudflare **Access** (One-time PIN, Policy mit genau zwei Adressen).

- **Laden:** App holt den Referenzstand Repo-frisch via `/api/state` und vergleicht
  `meta.revision` mit dem `localStorage`-Arbeitsstand. Referenzstand neuer → erst **stiller
  3-Wege-Merge**, nur bei Konflikt oder fehlender Basis fragt ein Dialog.
- **Speichern:** App schickt den State an `/api/save` → wird ein **Commit** auf `main`
  (GitHub Contents API). Revision wird nur bei **Erfolg** gezogen. `save.js` prüft:
  eingehende Revision ≤ Repo-Revision → **HTTP 409**, kein Commit; die App merged
  automatisch + genau **ein** erneuter Save.
- **Verwerfen:** Toolbar-Button setzt den Arbeitsstand nach Sicherheitsabfrage auf den
  gespeicherten Stand zurück (Cache leeren + Reload).
- **Bilder:** Einfügen (Paste, Drag&Drop, URL) lädt via `/api/image` hoch → Commit nach
  `docs/images/`. Sofort-Anzeige über lokale Objekt-URL.
- **Secrets/Env im Pages-Projekt (nur serverseitig, nie im Repo):** `GITHUB_TOKEN`
  (fine-grained PAT, nur dieses Repo, nur Contents R/W), `GITHUB_REPO`, `FILE_PATH`
  (= `docs/roadmap.json`), `BRANCH` (= `main`).

## Sync: gleichzeitiges Arbeiten (3-Wege-Merge)
- **UI-Zustand pro Gerät:** activeAct/activeView im localStorage (`sv_uiState`), nicht in
  der Datei — niemandes Save springt dem anderen in die Ansicht.
- **Basis-Buchhaltung:** `sv_baseState` (localStorage) = Repo-Stand, auf dem die eigene
  Arbeit aufsetzt; gepflegt bei jedem Laden und erfolgreichen Save.
- **Stiller Auto-Merge (`svMerge3`):** Basis/Meins/Fremd **pro Objekt-id**. Disjunkte
  Änderungen laufen automatisch zusammen — an drei Stellen: Banner-Check (nur bei „Ruhe"),
  409 beim Speichern (Merge + ein Retry), Boot (Merge statt Dialog).
- **Konflikt** = dasselbe Objekt beidseitig geändert (oder löschen-vs-ändern): Merge bricht
  **komplett** ab, klare Meldung mit Objektnennung, nichts wird überschrieben. Playbook:
  Export JSON → neu laden → OK → die eine strittige Änderung nachziehen.
- **WICHTIG (Firefox):** Im Rückfall-Dialog **niemals** „Don't allow … to prompt you again"
  anhaken — unterdrückt alle Bestätigungsdialoge der Seite.

## Git
- Repo (**öffentlich**): `github.com/CptHectorX/DangerMouse`, Branch `main`.
  Alias: `git save "<msg>"` = `add -A` + `commit` + `push`.
- Commit-Regeln siehe **Code- und Commit-Stil** ganz oben.
- **Vor Arbeitsbeginn `git pull`** — Online-Saves und Juli landen als Commits auf `main`.
  Push abgewiesen → `git pull --rebase && git push`.
- **`roadmap.json` hat zwei Schreiber** (Git + Online-Saves). Bei verhedderten Ständen:
  Rettungskopie der Code-Dateien → `git reset --hard origin/main` → js/css/html
  zurückkopieren → JSON-Buchhaltung auf der Server-Wahrheit neu aufsetzen. Nie die eigene
  `roadmap.json` blind über die Server-Version committen.
- **Commits sauber trennen:** Werkzeug (`docs/`) und Spiel (Godot) getrennt committen.

## Auslieferung (itch.io)
Ausgeliefert wird **ausschließlich das Ergebnis des Web-Exports** (`index.html`, `.pck`,
`.wasm`, `.js`) — nicht das Repo.

- **`docs/` ist niemals Teil der Auslieferung.** Das Board ist Werkzeug, nicht Spiel.
  `docs/.gdignore` sorgt dafür, dass Godot das Verzeichnis gar nicht erst einliest —
  **die Datei nicht löschen**.
- Das Export-Feld *Filters to export non-resource files/folders* bleibt **leer**. Ein
  `*` oder `*.md` darin hebelt die `.gdignore` aus und zieht das Board mit in die `.pck`.
- Gegenprobe nach jedem Export im Ausgabeverzeichnis: `strings *.pck | grep -c "res://docs"`
  muss `0` liefern.
- Das Export-Ziel liegt außerhalb des Repos oder in einem per `.gitignore` ausgeschlossenen
  Verzeichnis — Build-Artefakte werden nicht committet.
