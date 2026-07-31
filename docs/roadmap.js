/* ============================================================
 *  StarVoyage - Mission Log  (roadmap.js)
 *  Datei-Navigation / Inhaltsverzeichnis - Zeilen zeigen auf den Abschnittsanfang.
 * ------------------------------------------------------------
 *  State / globale Variablen (Block 1)                                             Zeile 29
 *  Undo/Redo-Historie                                                              Zeile 52
 *  Boot, Datei laden/speichern, Export                                             Zeile 102
 *  View-Dispatch, Kopf, Sidebar, Toolbar                                           Zeile 307
 *  Board-Ansicht: Karten, Timeline, DnD                                            Zeile 384
 *  Karten-Editor (Modal)                                                           Zeile 571
 *  Hilfsfunktionen (Status, Escape, Markdown)                                      Zeile 620
 *  Changelog & Dokumentation                                                       Zeile 872
 *  State / globale Variablen (Block 2)                                             Zeile 1039
 *  Architektur: Daten, Rendering, Kanten                                           Zeile 1067
 *  Architektur: Auswahl, Copy/Paste                                                Zeile 1253
 *  Architektur: DnD, Zoom, Editoren, Subnav                                        Zeile 1332
 *  Moodboard: Daten, View, Elemente                                                Zeile 1713
 *  Moodboard: Verbindungen & Pfade                                                 Zeile 1869
 *  Moodboard: Auswahl, Snapping, Gruppen                                           Zeile 2053
 *  Moodboard: Text, Panel, Notizen                                                 Zeile 2249
 *  Moodboard: DnD, Resize, Zoom                                                    Zeile 2500
 *  Moodboard: Subnav, Ordner, Sidebar-DnD                                          Zeile 3315
 *  Persistenz (IndexedDB) & Bilder                                                 Zeile 3549
 *  Bild einfuegen / aus URL laden                                                  Zeile 3618
 *  Sync: 3-Wege-Merge (Basis, Objekt-Diff, Auto-Merge)                             Zeile 3705
 *  Event-Wiring: Toolbar, Shortcuts, Clipboard, Mittelklick-Guard, Sidebar-Resize  Zeile 4106
 * ============================================================ */

let state = null;
let fileHandle = null;
let editingId = null;
let dirty = false;

// UI-Zustand (welcher Act / welche Ansicht offen ist) — pro Geraet im localStorage,
// NICHT in der roadmap.json: sonst ueberschreibt jeder Save die Ansicht des anderen
// und der spaetere Merge bekaeme Unsinn-Konflikte (Ticket-Schritt 1 des Sync-Dreischritts).
const SV_UI_KEY = "sv_uiState";
let uiState = (() => {
  try { return JSON.parse(localStorage.getItem(SV_UI_KEY)) || {}; } catch (_) { return {}; }
})();
function svSaveUiState() {
  try { localStorage.setItem(SV_UI_KEY, JSON.stringify(uiState)); } catch (_) {}
}
function setActiveAct(id)  { uiState.activeAct  = id; svSaveUiState(); }
function setActiveView(v)  { uiState.activeView = v;  svSaveUiState(); }

// Gehostet (Cloudflare Pages) vs. lokal (start.sh / file://): entscheidet den Speicherweg.
const IS_HOSTED = location.protocol === "https:" && !["localhost", "127.0.0.1"].includes(location.hostname);

/* ---------- Undo/Redo (Architektur + Moodboard, arbeitet auf dem gesamten state) ---------- */
let histStack = [], histRedo = [], histPrevStr = null, histTimer = null, histBusy = false;
function histInit() { histPrevStr = state ? JSON.stringify(state) : null; histStack = []; histRedo = []; }
function histRecord() {                                   // aktuellen Stand aufnehmen, wenn er sich geaendert hat
  if (histBusy || histPrevStr == null || !state) return;
  const cur = JSON.stringify(state);
  if (cur === histPrevStr) return;
  histStack.push(histPrevStr); if (histStack.length > 60) histStack.shift();
  histRedo = []; histPrevStr = cur;
  svCacheState(cur);                                      // gleiche Aenderung sofort sichern (localStorage)
}
function histTouch() { clearTimeout(histTimer); histTimer = setTimeout(histRecord, 300); }  // gebuendelt (Tippen/Slider)
function histRestore(str) {
  histBusy = true;
  state = JSON.parse(str); dirty = true;
  mbSel = []; mbSelConn = null; mbReassign = null; mbEpDrag = null; mbNoteOpenId = null;
  render();
  histBusy = false;
  histPrevStr = JSON.stringify(state);
}
function histUndo() {
  clearTimeout(histTimer); histRecord();                 // ausstehendes erst festschreiben
  if (!histStack.length) { setStatus("Nichts zum Rückgängigmachen.", ""); return; }
  histRedo.push(JSON.stringify(state));
  histRestore(histStack.pop());
  setStatus("Rückgängig gemacht.", "");
}
function histRedoAction() {
  clearTimeout(histTimer);
  if (!histRedo.length) { setStatus("Nichts zum Wiederherstellen.", ""); return; }
  histStack.push(JSON.stringify(state)); if (histStack.length > 60) histStack.shift();
  histRestore(histRedo.pop());
  setStatus("Wiederhergestellt.", "");
}

const STATUS_META = {
  done:    { label: "Fertig",  color: "var(--s-done)" },
  doing:   { label: "Läuft",   color: "var(--s-doing)" },
  todo:    { label: "Offen",   color: "var(--s-todo)" },
  planned: { label: "Geplant", color: "var(--s-planned)" }
};
// Icon used as the "you are here" marker per theme
const ACT_MARKER = { space: "🛸", adventure: "🐵", surface: "🎖️", gamedev: "🛠️" };

const $ = sel => document.querySelector(sel);

function activeAct() {
  // UI-Zustand zuerst; Fallback auf state.meta.activeAct nur als Migration von alten Dateien.
  const id = uiState.activeAct || (state.meta && state.meta.activeAct);
  return state.acts.find(a => a.id === id) || state.acts[0];
}

async function boot() {
  if (typeof EMBEDDED !== "undefined" && EMBEDDED) { state = EMBEDDED; render(); return; }
  // Referenzstand laden (fuer Revision-Vergleich bzw. als Datenquelle).
  // Gehostet: /api/roadmap liest direkt aus dem Repo — die statische roadmap.json hinkt
  // nach einem Online-Save bis zum Redeploy hinterher und wuerde den Vergleich taeuschen.
  // Lokal: roadmap.json daneben (http via start.sh; unter file:// blockiert -> fileState bleibt null).
  let fileState = null;
  if (IS_HOSTED) {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (res.ok) fileState = await res.json();
    } catch(e) {}
  }
  if (!fileState) {                                      // lokal — oder Fallback, falls die Function klemmt
    try {
      const res = await fetch("roadmap.json", { cache: "no-store" });
      if (res.ok) fileState = await res.json();
    } catch(e) {}
  }
  // 1) Gecachter Arbeitsstand (inkl. ungespeicherter Aenderungen) — aber nur, wenn die Datei nicht neuer ist.
  const cached = svLoadState();
  if (cached) {
    const cachedRev = (cached.meta && cached.meta.revision) || 0;
    const fileRev = (fileState && fileState.meta && fileState.meta.revision) || 0;
    if (fileRev > cachedRev) {
      // Jemand anderes hat gespeichert: erst den stillen Auto-Merge versuchen (Sync 3a) …
      const mres = svMerge3(svLoadBase(), cached, fileState);
      if (mres.ok) {
        state = mres.state;
        svSaveBase(JSON.stringify(fileState));
        svCacheState(JSON.stringify(state));
        setStatus("Zusammengefuehrt: " + mres.fromTheirs + " fremde Aenderung(en) uebernommen, " +
                  mres.fromMine + " eigene erhalten (Rev " + fileRev + ").","ok");
        render(); histInit(); return;
      }
      // … sonst wie bisher nachfragen statt stillschweigend den alten Stand zeigen.
      const useFile = confirm(
        "Es gibt eine neuere Version der Roadmap (Rev " + fileRev + ", dein Arbeitsstand: Rev " + cachedRev + ").\n\n" +
        "OK = Neuere Version laden (dein lokaler Arbeitsstand wird verworfen)\n" +
        "Abbrechen = Eigenen Arbeitsstand behalten"
      );
      if (useFile) {
        state = fileState; dirty = false;
        svSaveBase(JSON.stringify(fileState));
        svCacheState(JSON.stringify(state));
        setStatus("Neuere Version geladen (Rev " + fileRev + ").","ok"); render(); histInit(); return;
      }
      state = cached;
      setStatus("Eigener Arbeitsstand behalten (Rev " + cachedRev + ") — Achtung: Datei ist bei Rev " + fileRev + ".","warn");
      render(); histInit(); return;
    }
    if (fileState && fileRev === cachedRev && !svLoadBase()) svSaveBase(JSON.stringify(fileState));   // Basis-Migration: Datei == Arbeitsstand-Rev
    state = cached; setStatus("Arbeitsstand wiederhergestellt — „Speichern“ schreibt in die Datei.","ok"); render(); histInit(); return;
  }
  // 2) Kein Cache: Datei nehmen, falls geladen.
  if (fileState) { state = fileState; svSaveBase(JSON.stringify(fileState)); setStatus("roadmap.json geladen.","ok"); render(); histInit(); return; }
  renderEmptyState();
}

// Shown when no data is loaded yet: a clear call to action, no placeholder data.
function renderEmptyState() {
  const host = document.getElementById("view-board") || document.body;
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  const board = document.getElementById("view-board");
  if (board) board.classList.add("active");
  const el = document.getElementById("board");
  if (el) el.innerHTML = '';
  const tl = document.getElementById("timeline");
  if (tl) tl.innerHTML = '';
  const lg = document.getElementById("legend");
  if (lg) lg.innerHTML = '';
  const wrap = document.querySelector(".board-wrap");
  if (wrap) {
    let hint = document.getElementById("__emptyHint");
    if (!hint) {
      hint = document.createElement("div");
      hint.id = "__emptyHint";
      hint.className = "empty-state";
      wrap.prepend(hint);
    }
    hint.innerHTML = 'Keine Daten geladen. Klicke oben auf <strong>„Datei öffnen“</strong> und wähle deine <code>roadmap.json</code>.';
  }
  setStatus("Bereit — „Datei öffnen“ wählt roadmap.json.","");
}

async function openFile() {
  if (!window.showOpenFilePicker) { setStatus("Browser ohne File-System-Zugriff. Nutze Chromium/Chrome, oder „Export JSON“.","warn"); return; }
  try {
    const [handle] = await window.showOpenFilePicker({ types: [{ description: "Roadmap JSON", accept: { "application/json": [".json"] } }] });
    fileHandle = handle;
    svSaveFileHandle(handle);                             // Handle merken -> „Speichern“ findet die Datei nach Reload wieder
    state = JSON.parse(await (await handle.getFile()).text());
    dirty = false;
    setStatus("Geladen: " + handle.name + " — speicherbar.","ok");
    render();
    histInit();
    svCacheState(JSON.stringify(state));                  // geladenen Stand sofort sichern
  } catch(e) { if (e.name !== "AbortError") setStatus("Fehler: " + e.message,"warn"); }
}

async function saveFile() {
  if (!state) return;
  if (IS_HOSTED) { return saveOnline(); }                // gehostet: Save geht als Commit via /api/save
  if (!fileHandle) {
    if (!window.showSaveFilePicker) { exportJson(); return; }
    try { fileHandle = await window.showSaveFilePicker({ suggestedName: "roadmap.json", types: [{ description: "Roadmap JSON", accept: { "application/json": [".json"] } }] }); }
    catch(e) { if (e.name === "AbortError") return; }
    svSaveFileHandle(fileHandle);                        // frisch gewaehlten Handle ebenfalls merken
  }
  const snap = bumpRevision();                           // Nummer ziehen — bei Fehlschlag unten zurueckgeben
  try {
    const w = await fileHandle.createWritable();
    await w.write(serializeState(true));
    await w.close();
    await mbGcImages();                                  // nicht mehr referenzierte Bilder aufraeumen
    dirty = false;
    svSaveBase(serializeState(false));                   // erfolgreich gespeichert -> neue Basis
    setStatus("Gespeichert → " + fileHandle.name + " (Rev " + state.meta.revision + ")","ok");
    render();
  } catch(e) { revertRevision(snap); setStatus("Speichern fehlgeschlagen: " + e.message,"warn"); }
}

// Gehosteter Speicherweg: POST an die Pages Function, die roadmap.json ins Repo committet.
async function saveOnline(isRetry) {
  const snap = bumpRevision();                           // Nummer ziehen — nur bei Erfolg behalten
  try {
    setStatus("Speichere online …","");
    const res = await fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: serializeState(false),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) {
      revertRevision(snap);
      // Sync 3a: erst still zusammenfuehren versuchen, dann direkt erneut speichern.
      // Genau EIN Wiederholungsversuch — speichert waehrenddessen schon wieder jemand,
      // gilt beim zweiten 409 das bisherige Verhalten (kein Endlos-Ping-Pong).
      if (!isRetry) {
        try {
          const theirs = await svFetchRemoteState();
          const mres = svMerge3(svLoadBase(), JSON.parse(serializeState(false)), theirs);
          if (mres.ok) {
            svApplyMerge(mres.state, JSON.stringify(theirs));
            setStatus("Zusammengefuehrt (" + mres.fromTheirs + " fremde uebernommen) — speichere erneut …","");
            return saveOnline(true);
          }
          setStatus("Konflikt: " + mres.conflicts.length + " Objekt(e) beidseitig geaendert (z.B. " +
                    (mres.conflicts[0] || "?") + "). Seite neu laden und abstimmen.","warn");
          return;
        } catch (_) { /* Merge-Versuch gescheitert -> klassische Meldung unten */ }
      }
      setStatus("Konflikt: Im Repo liegt schon Rev " + (data.repoRevision != null ? data.repoRevision : "?") +
                " (deine: " + ((state.meta && state.meta.revision) || 0) + "). Seite neu laden, um die neuere Version zu holen.","warn");
      return;
    }
    if (!res.ok || !data.ok) throw new Error(data.error || ("HTTP " + res.status));
    await mbGcImages();                                  // nicht mehr referenzierte Bilder aufraeumen
    dirty = false;
    svSaveBase(serializeState(false));                   // erfolgreich gespeichert -> das ist die neue Basis
    svCacheState(JSON.stringify(state));                 // Cache traegt jetzt die neue Revision
    setStatus("Online gespeichert" + (isRetry ? " nach Zusammenfuehrung" : "") + " → Commit " + String(data.commit || "").slice(0,7) + " (Rev " + state.meta.revision + ")","ok");
    render();
  } catch(e) { revertRevision(snap); setStatus("Online-Speichern fehlgeschlagen: " + e.message,"warn"); }
}

function exportJson() {
  if (!state) return;
  bumpRevision();
  const blob = new Blob([serializeState(true)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "roadmap.json"; a.click();
  URL.revokeObjectURL(a.href);
  setStatus("Exportiert (Rev " + state.meta.revision + ") — ins docs/ legen & committen.","ok");
  render();
}

// Serialisierung fuer Datei/Export/Online-Save: UI-Zustand (activeAct/activeView) bleibt
// draussen — der lebt pro Geraet im localStorage und gehoert nicht in die gemeinsame Wahrheit.
function serializeState(pretty) {
  const copy = JSON.parse(JSON.stringify(state));
  if (copy.meta) { delete copy.meta.activeAct; delete copy.meta.activeView; }
  return pretty ? JSON.stringify(copy, null, 2) : JSON.stringify(copy);
}

function bumpRevision() {
  if (!state.meta) state.meta = {};
  const snap = { revision: state.meta.revision || 0, updated: state.meta.updated };
  state.meta.revision = (state.meta.revision || 0) + 1;
  state.meta.updated = new Date().toISOString().slice(0,10);
  return snap;                                             // fuer revertRevision bei fehlgeschlagenem Save
}

// Gegenstueck zu bumpRevision: bei fehlgeschlagenem Save die Nummer zurueckgeben,
// sonst maskiert die aufgeblasene Cache-Revision spaeter den Boot-Konflikt-Check.
function revertRevision(snap) {
  if (!state || !state.meta || !snap) return;
  state.meta.revision = snap.revision;
  state.meta.updated = snap.updated;
  svCacheState(JSON.stringify(state));                     // Cache sofort korrigieren
}

/* ---------- Render ---------- */
function currentView() { return uiState.activeView || (state.meta && state.meta.activeView) || "board"; }

function render() {
  const eh = document.getElementById("__emptyHint");
  if (eh) eh.remove();
  svCacheState();                                          // aktuellen Stand entprellt in IndexedDB sichern
  document.body.setAttribute("data-theme", activeAct().theme || "space");
  renderActs();
  renderHeader();
  renderSidebar();
  renderToolbar();

  // Toggle views
  const view = currentView();
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  const active = document.getElementById("view-" + view);
  if (active) active.classList.add("active");

  // Render only what's visible
  if (view === "board") {
    renderLegend();
    renderTimeline();
    renderBoard();
  } else if (view === "changelog") {
    renderChangelog();
  } else if (view === "docs") {
    renderDocs();
  } else if (view === "architecture") {
    renderArchitecture();
  } else if (view === "moodboard") {
    renderMoodboard();
  }
}

function renderSidebar() {
  const view = currentView();
  document.querySelectorAll(".nav-item").forEach(b =>
    b.classList.toggle("active", b.dataset.view === view));
  renderArchSubnav(view);
  renderMbSubnav(view);
  const foot = $("#sideFoot");
  if (foot) foot.textContent = "Rev " + (state.meta.revision||0);
}

function renderToolbar() {
  // "+ Karte" label adapts to the current view
  const view = currentView();
  const add = $("#btnAdd");
  const labels = { board: "+ Karte", changelog: "+ Eintrag", docs: "+ Dokument", architecture: "+ Knoten" };
  if (view === "moodboard") { add.style.display = "none"; }
  else { add.style.display = ""; add.textContent = labels[view] || "+ Karte"; }
}

function renderActs() {
  const curId = activeAct().id;
  $("#acts").innerHTML = state.acts.map(a => `
    <button class="act-btn ${a.id===curId?"active":""}" data-act="${a.id}">
      ${escapeHtml(a.name)}
      <span class="tag">${escapeHtml(a.tagline||"")}</span>
    </button>`).join("");
  document.querySelectorAll(".act-btn").forEach(b =>
    b.addEventListener("click", () => { setActiveAct(b.dataset.act); activeDiagramId = null; activeBoardId = null; mbSel = []; archSel = []; render(); }));
}

function renderHeader() {
  const act = activeAct(), m = state.meta;
  $("#brandName").textContent = (m.project||"STARVOYAGE").toUpperCase();
  $("#brandSub").textContent = act.name;
  $("#metaStrip").innerHTML =
    `<span>${escapeHtml(act.tagline||"")}</span>` +
    (act.reference ? `<span>Ref: <b>${escapeHtml(act.reference)}</b></span>` : "") +
    `<span class="rev-badge">Rev ${m.revision||0} · ${m.updated||""}</span>`;
}

function renderLegend() {
  $("#legend").innerHTML = Object.values(STATUS_META).map(v =>
    `<span><i style="background:${v.color}"></i>${v.label}</span>`).join("");
}

function orderedCards() {
  // Group by status in the fixed column order. Within a group, keep the manual
  // array order (drag-to-sort) — EXCEPT "done", which stays sorted by date.
  const order = { done:1, doing:2, todo:3, planned:4 };
  const cards = activeAct().cards;
  const withIdx = cards.map((c,i) => ({ c, i }));
  withIdx.sort((a,b) => {
    if (order[a.c.status] !== order[b.c.status]) return order[a.c.status]-order[b.c.status];
    if (a.c.status === "done") {
      // fixed chronological order for finished work
      const d = (a.c.date||"9999").localeCompare(b.c.date||"9999");
      if (d !== 0) return d;
    }
    return a.i - b.i; // manual array order within the group
  });
  return withIdx.map(x => x.c);
}

function renderTimeline() {
  const act = activeAct();
  const cards = orderedCards();
  // "current" = last done card, or first doing card — the leading edge of progress
  let currentIdx = -1;
  const firstDoing = cards.findIndex(c => c.status === "doing");
  if (firstDoing >= 0) currentIdx = firstDoing;
  else { for (let i=0;i<cards.length;i++) if (cards[i].status==="done") currentIdx=i; }
  const marker = ACT_MARKER[act.theme] || "🛸";

  $("#timeline").innerHTML = cards.map((c,i) => `
    <div class="tl-node ${i===currentIdx?"current":""}" data-idx="${i}">
      ${i===currentIdx?`<span class="tl-marker">${marker}</span>`:""}
      <span class="tl-dot ${c.status}"></span>
      <div class="tl-body">
        <div class="tl-title">${escapeHtml(c.title)}</div>
        <div class="tl-date">${c.date || STATUS_META[c.status].label}</div>
      </div>
    </div>`).join("");

  // Auto-focus current node
  requestAnimationFrame(() => {
    const cur = document.querySelector(".tl-node.current");
    if (cur) cur.scrollIntoView({ inline: "center", block: "nearest" });
  });
}

function renderBoard() {
  const act = activeAct();
  const cols = [...act.columns].sort((a,b)=>a.order-b.order);
  const phaseName = id => (act.phases.find(p=>p.id===id)||{}).name || id;
  const ordered = orderedCards(); // respects manual order + done-by-date
  $("#board").innerHTML = cols.map(col => {
    const cards = ordered.filter(c => c.status === col.id);
    return `
      <div class="column col-${col.id}">
        <div class="col-head"><span class="name">${escapeHtml(col.name)}</span><span class="count">${cards.length}</span></div>
        <div class="col-body" data-col="${col.id}">
          ${cards.length ? cards.map(c => cardHtml(c, phaseName)).join("") : '<div class="empty-hint">— leer —</div>'}
        </div>
      </div>`;
  }).join("");
  wireDnD();
}

function cardHtml(c, phaseName) {
  const tags = (c.tags||[]).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("");
  const locked = c.status === "done";
  const key = cardKeyOf(activeAct(), c);
  return `
    <div class="card ${c.status}${locked?" locked":""}" draggable="${locked?"false":"true"}" data-id="${c.id}">
      <div class="card-title">${escapeHtml(c.title)}${locked?' <span class="lock">🔒</span>':''}</div>
      <div class="card-foot">
        ${key ? `<span class="card-key" title="Verlinkbar als [${key}]">${key}</span>` : ""}
        <span class="phase-pill">${escapeHtml(phaseName(c.phase))}</span>
        ${tags}
        ${c.date ? `<span class="card-date">${c.date}</span>` : ""}
      </div>
    </div>`;
}

let dragId = null;
let dragStatus = null;      // status of the card being dragged
let lastDropKey = null;     // remembers last indicator position to avoid redundant DOM work

function wireDnD() {
  document.querySelectorAll(".card").forEach(el => {
    el.addEventListener("dragstart", e => {
      dragId = el.dataset.id;
      const c = activeAct().cards.find(x => x.id === dragId);
      dragStatus = c ? c.status : null;
      el.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    el.addEventListener("dragend", () => { el.classList.remove("dragging"); dragId=null; dragStatus=null; lastDropKey=null; clearDropLine(); });
    el.addEventListener("click", () => openEditor(el.dataset.id));
  });
  document.querySelectorAll(".col-body").forEach(body => {
    const col = body.dataset.col;
    const isDoneCol = (col === "done");
    // Dragging a card that is ALREADY done: forbidden (done order is locked).
    // Dropping a NEW card into done: allowed, but it always lands at the end.
    const blocked = (dragStatus === "done");

    body.addEventListener("dragover", e => {
      if (blocked) { e.dataTransfer.dropEffect = "none"; return; }
      e.preventDefault();
      body.classList.add("drag-over");
      if (isDoneCol) {
        // Always show the drop line at the very end — no in-column sorting.
        const key = "done|END";
        if (key !== lastDropKey) { lastDropKey = key; showDropLine(body, null); }
        return;
      }
      const beforeId = cardIdAfterPoint(body, e.clientY);
      const key = col + "|" + (beforeId || "END");
      if (key !== lastDropKey) { lastDropKey = key; showDropLine(body, beforeId); }
    });
    body.addEventListener("dragleave", e => {
      if (!body.contains(e.relatedTarget)) { body.classList.remove("drag-over"); clearDropLine(); lastDropKey=null; }
    });
    body.addEventListener("drop", e => {
      if (blocked) return;
      e.preventDefault();
      body.classList.remove("drag-over");
      clearDropLine(); lastDropKey=null;
      if (!dragId) return;
      const act = activeAct();
      const card = act.cards.find(c => c.id === dragId);
      if (!card) return;
      const newStatus = col;
      // In the done column, force "append at end"; otherwise use the cursor position.
      const beforeId = isDoneCol ? null : cardIdAfterPoint(body, e.clientY);

      const statusChanged = card.status !== newStatus;
      card.status = newStatus;
      if (newStatus === "done" && !card.date) card.date = new Date().toISOString().slice(0,10);
      reorderCard(act, card, beforeId);

      dirty = true;
      setStatus(statusChanged
        ? "Verschoben: „" + card.title + "“ → " + STATUS_META[newStatus].label + " (nicht gespeichert)"
        : "Neu einsortiert: „" + card.title + "“ (nicht gespeichert)", "warn");
      render();
    });
  });
}

// Insert the glowing line before the given card id (or at the end / empty column).
function showDropLine(body, beforeId) {
  clearDropLine();
  const line = document.createElement("div");
  line.className = "drop-line";
  line.id = "__dropLine";
  if (beforeId) {
    const ref = body.querySelector(`.card[data-id="${beforeId}"]`);
    if (ref) { body.insertBefore(line, ref); return; }
  }
  const hint = body.querySelector(".empty-hint");
  if (hint) body.insertBefore(line, hint);
  else body.appendChild(line);
}
function clearDropLine() {
  const l = document.getElementById("__dropLine");
  if (l) l.remove();
}

function cardIdAfterPoint(body, y) {
  const cards = [...body.querySelectorAll(".card:not(.dragging)")];
  for (const el of cards) {
    const r = el.getBoundingClientRect();
    if (y < r.top + r.height / 2) return el.dataset.id;
  }
  return null;
}

function reorderCard(act, card, beforeId) {
  const arr = act.cards;
  arr.splice(arr.indexOf(card), 1);
  if (beforeId) {
    const idx = arr.findIndex(c => c.id === beforeId);
    if (idx >= 0) { arr.splice(idx, 0, card); return; }
  }
  let lastSame = -1;
  arr.forEach((c,i) => { if (c.status === card.status) lastSame = i; });
  if (lastSame >= 0) arr.splice(lastSame + 1, 0, card);
  else arr.push(card);
}

function openEditor(id) {
  const act = activeAct();
  editingId = id;
  const c = id ? act.cards.find(x=>x.id===id) : { title:"", notes:"", status:"todo", phase: act.phases[0].id, tags:[], date:"" };
  const cKey = cardKeyOf(act, c);
  $("#modalTitle").textContent = id ? ("Karte bearbeiten" + (cKey ? "  ·  " + cKey : "")) : "Neue Karte";
  $("#fTitle").value = c.title || "";
  $("#fNotes").value = c.notes || "";
  $("#fTags").value = (c.tags||[]).join(", ");
  $("#fDate").value = c.date || "";
  $("#fStatus").innerHTML = act.columns.map(col => `<option value="${col.id}" ${c.status===col.id?"selected":""}>${col.name}</option>`).join("");
  $("#fPhase").innerHTML = act.phases.map(p => `<option value="${p.id}" ${c.phase===p.id?"selected":""}>${p.name}</option>`).join("");
  $("#btnDelete").style.display = id ? "" : "none";
  mdSetMode("edit");
  notesSnapshot = $("#fNotes").value;
  $("#modalBackdrop").classList.add("open");
  $("#fTitle").focus();
}
function closeEditor() { $("#modalBackdrop").classList.remove("open"); editingId=null; }

function saveCard() {
  const act = activeAct();
  const data = {
    title: $("#fTitle").value.trim(),
    notes: $("#fNotes").value.trim(),
    status: $("#fStatus").value,
    phase: $("#fPhase").value,
    tags: $("#fTags").value.split(",").map(s=>s.trim()).filter(Boolean),
    date: $("#fDate").value.trim()
  };
  if (!data.title) { $("#fTitle").focus(); return; }
  if (editingId) { Object.assign(act.cards.find(c=>c.id===editingId), data); }
  else { data.id = act.id.slice(0,2) + "-" + Date.now().toString(36); data.num = nextCardNum(act); act.cards.push(data); }
  dirty = true; closeEditor();
  setStatus("Karte übernommen (nicht gespeichert).","warn");
  render();
}

function deleteCard() {
  if (!editingId) return;
  const act = activeAct();
  const c = act.cards.find(x=>x.id===editingId);
  if (!confirm("Karte „"+c.title+"“ wirklich löschen?")) return;
  act.cards = act.cards.filter(x=>x.id!==editingId);
  dirty = true; closeEditor();
  setStatus("Karte gelöscht (nicht gespeichert).","warn");
  render();
}

function setStatus(msg, cls) {
  const el = $("#statusMsg"); el.textContent = msg; el.className = "status-msg " + (cls||"");
  if (msg) svStatusLogPush(msg, cls || "");
}

// --- Status-Historie: alle Meldungen der Session, per Klick auf die Statuszeile ---
const svStatusLog = [];                                    // {time, msg, kind} — nur diese Session
function svStatusLogPush(msg, kind) {
  svStatusLog.push({ time: new Date(), msg, kind });
  const list = $("#statusPanelList");
  if (list) svStatusPanelRender();                         // Panel offen -> live nachziehen
}
function svStatusPanelRender() {
  const list = $("#statusPanelList");
  if (!list) return;
  list.innerHTML = svStatusLog.slice().reverse().map(e =>
    '<div class="status-entry ' + e.kind + '"><span class="status-time">' +
    e.time.toLocaleTimeString("de-DE") + '</span>' + escapeHtml(e.msg) + '</div>'
  ).join("") || '<div class="status-entry">Noch keine Meldungen in dieser Session.</div>';
}
function svStatusPanelToggle() {
  const p = $("#statusPanel");
  const open = p.classList.toggle("open");
  if (open) svStatusPanelRender();
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m])); }

/* Minimal, safe Markdown -> HTML. Escapes first, then applies inline + block rules. */
/* ---------- Kartenschluessel & Verlinkung ([GDH-001]) ---------- */

// Das Kuerzel eines Akts steht als "key" in der roadmap.json, nicht im Code:
// ein fuenfter Akt soll keine Code-Aenderung kosten.
function actByKey(key) {
  if (!state || !state.acts) return null;
  const k = String(key).toUpperCase();
  return state.acts.find(a => String(a.key || "").toUpperCase() === k) || null;
}
function cardByNum(act, num) {
  if (!act) return null;
  const n = parseInt(num, 10);
  return (act.cards || []).find(c => Number(c.num) === n) || null;
}
function cardKeyOf(act, card) {
  if (!act || !act.key || !card || !card.num) return "";
  return act.key + "-" + String(card.num).padStart(3, "0");
}
// Ein toter Verweis wird sichtbar gemacht statt still als Text durchzurutschen -
// sonst faellt ein Tippfehler im Kuerzel nie auf.
function cardLinkHtml(key, num) {
  const label = escapeHtml(key + "-" + num);
  const act = actByKey(key);
  const card = cardByNum(act, num);
  if (!card) return `<span class="cardlink dead" title="Keine Karte mit diesem Schluessel">${label}</span>`;
  return `<a href="#" class="cardlink" data-act="${escapeHtml(act.id)}" data-num="${parseInt(num, 10)}" title="${escapeHtml(card.title)}">${label}</a>`;
}
// Klick auf einen Kartenlink: Akt wechseln, aufs Board, hinscrollen, kurz hervorheben.
function gotoCard(actId, num) {
  // Aus der Notiz-Vorschau geklickt: erst das Bearbeitungsfenster zu, sonst
  // laege es nach dem Sprung noch ueber dem Board.
  const bd = document.getElementById("modalBackdrop");
  if (bd && bd.classList.contains("open")) {
    const ta = document.getElementById("fNotes");
    if (ta && ta.value !== notesSnapshot &&
        !confirm("Ungespeicherte Änderungen an dieser Karte gehen verloren. Trotzdem springen?")) return;
    closeEditor();
  }
  const act = (state.acts || []).find(a => a.id === actId);
  const card = cardByNum(act, num);
  if (!card) return;
  setActiveAct(actId);
  setActiveView("board");
  activeDiagramId = null; activeBoardId = null; mbSel = []; archSel = [];
  render();
  requestAnimationFrame(() => {
    const el = document.querySelector('.card[data-id="' + card.id + '"]');
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("cardlink-target");
    setTimeout(() => el.classList.remove("cardlink-target"), 2000);
  });
}
document.addEventListener("click", e => {
  const a = e.target && e.target.closest ? e.target.closest("a.cardlink") : null;
  if (!a) return;
  e.preventDefault();
  gotoCard(a.dataset.act, a.dataset.num);
});
// Naechste freie Nummer im Akt. Der Zaehler laeuft nur vorwaerts, damit die Nummer
// einer geloeschten Karte nicht spaeter auf eine fremde Karte zeigt.
function nextCardNum(act) {
  const used = (act.cards || []).reduce((m, c) => Math.max(m, Number(c.num) || 0), 0);
  const n = Math.max(Number(act.nextNum) || 1, used + 1);
  act.nextNum = n + 1;
  return n;
}

/* ---------- GDH-037: Notizfeld - Werkzeugleiste und Vorschau ---------- */

// Stand der Notizen beim Oeffnen. Nur dafuer da, ungespeicherte Arbeit zu
// erkennen, bevor ein Kartenlink das Fenster wegnimmt.
let notesSnapshot = "";

// Legt ein Zeichenpaar um die Auswahl. Ohne Auswahl kommt ein Platzhalter rein,
// der gleich markiert ist - so kann man sofort darueber tippen.
function mdWrap(ta, a, b, platzhalter) {
  const s = ta.selectionStart, e = ta.selectionEnd;
  const sel = ta.value.slice(s, e) || platzhalter || "Text";
  ta.value = ta.value.slice(0, s) + a + sel + b + ta.value.slice(e);
  ta.selectionStart = s + a.length;
  ta.selectionEnd = s + a.length + sel.length;
  ta.focus();
}
// Setzt ein Zeichen vor jede angefasste Zeile. Steht es ueberall schon, wird es
// entfernt - derselbe Knopf schaltet also an und aus.
function mdPrefix(ta, p) {
  const v = ta.value;
  const s = v.lastIndexOf("\n", ta.selectionStart - 1) + 1;
  let e = v.indexOf("\n", ta.selectionEnd);
  if (e === -1) e = v.length;
  const zeilen = v.slice(s, e).split("\n");
  const alle = zeilen.every(l => l.startsWith(p));
  const neu = zeilen.map(l => alle ? l.slice(p.length) : p + l).join("\n");
  ta.value = v.slice(0, s) + neu + v.slice(e);
  ta.selectionStart = s; ta.selectionEnd = s + neu.length;
  ta.focus();
}
// Eigene Zeile einfuegen (Trennlinie).
function mdLine(ta, t) {
  const s = ta.selectionStart;
  const ins = (s === 0 || ta.value[s - 1] === "\n" ? "" : "\n") + t + "\n";
  ta.value = ta.value.slice(0, s) + ins + ta.value.slice(ta.selectionEnd);
  ta.selectionStart = ta.selectionEnd = s + ins.length;
  ta.focus();
}
// Verweis-Vorlage mit dem Kuerzel des aktuellen Akts; die Nummer wird markiert,
// damit man sie sofort ueberschreiben kann.
function mdCardRef(ta) {
  const act = activeAct();
  const key = (act && act.key) || "GDH";
  const s = ta.selectionStart;
  const ins = "[" + key + "-001]";
  ta.value = ta.value.slice(0, s) + ins + ta.value.slice(ta.selectionEnd);
  const n = s + key.length + 2;
  ta.selectionStart = n; ta.selectionEnd = n + 3;
  ta.focus();
}
// Umschalten zwischen Schreiben und Lesen. Die Vorschau benutzt denselben
// Renderer wie Changelog und Doku - Kartenlinks wirken hier also auch.
function mdSetMode(mode) {
  const ta = document.getElementById("fNotes");
  const pv = document.getElementById("fNotesPreview");
  const bar = document.getElementById("mdBar");
  if (!ta || !pv) return;
  const schreiben = mode !== "preview";
  ta.hidden = !schreiben;
  pv.hidden = schreiben;
  if (bar) bar.classList.toggle("disabled", !schreiben);
  document.querySelectorAll(".md-mode").forEach(b =>
    b.classList.toggle("active", (b.dataset.mode === "preview") !== schreiben));
  if (!schreiben) pv.innerHTML = mdToHtml(ta.value.trim() || "*Noch keine Notizen.*");
}
document.addEventListener("click", e => {
  const t = e.target;
  if (!t || !t.closest) return;
  const modus = t.closest(".md-mode");
  if (modus) { e.preventDefault(); mdSetMode(modus.dataset.mode); return; }
  const knopf = t.closest("#mdBar button");
  if (!knopf) return;
  e.preventDefault();
  const ta = document.getElementById("fNotes");
  if (!ta || ta.hidden) return;
  const k = knopf.dataset.md;
  if (k === "wrap") mdWrap(ta, knopf.dataset.a, knopf.dataset.b, knopf.dataset.ph);
  else if (k === "prefix") mdPrefix(ta, knopf.dataset.p);
  else if (k === "line") mdLine(ta, knopf.dataset.t);
  else if (k === "link") mdWrap(ta, "[", "](https://)", "Text");
  else if (k === "cardlink") mdCardRef(ta);
});

function mdToHtml(src) {
  if (!src) return "";
  const esc = escapeHtml(src);
  const lines = esc.split(/\r?\n/);
  let html = "", i = 0;
  const inline = t => t
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\[([A-Z]{2,5})-(\d{1,4})\]/g, (m, key, num) => cardLinkHtml(key, num));

  while (i < lines.length) {
    let line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }                       // blank
    let m;
    if (/^\s*```/.test(line)) {                                       // fenced code block
      i++; // skip opening ```
      let buf = [];
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // skip closing ```
      // Content is already HTML-escaped; keep it verbatim (monospace, lines preserved)
      html += `<pre><code>${buf.join("\n")}</code></pre>`;
      continue;
    }
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {                      // heading
      const lvl = m[1].length; html += `<h${lvl}>${inline(m[2])}</h${lvl}>`; i++; continue;
    }
    if (/^\s*>\s?/.test(line)) {                                      // blockquote
      let buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(inline(lines[i].replace(/^\s*>\s?/,""))); i++; }
      html += `<blockquote>${buf.join("<br>")}</blockquote>`; continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {                                   // unordered list
      let buf = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*[-*]\s+/, "").trim(); i++;
        // Fortsetzungszeilen eines hart umbrochenen Punktes gehoeren an denselben <li>
        while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*>|\s*[-*]\s|\s*\d+\.\s|\s*```)/.test(lines[i])) {
          item += " " + lines[i].trim(); i++;
        }
        buf.push(`<li>${inline(item)}</li>`);
      }
      html += `<ul>${buf.join("")}</ul>`; continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {                                  // ordered list
      let buf = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*\d+\.\s+/, "").trim(); i++;
        // Fortsetzungszeilen eines hart umbrochenen Punktes gehoeren an denselben <li>
        while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*>|\s*[-*]\s|\s*\d+\.\s|\s*```)/.test(lines[i])) {
          item += " " + lines[i].trim(); i++;
        }
        buf.push(`<li>${inline(item)}</li>`);
      }
      html += `<ol>${buf.join("")}</ol>`; continue;
    }
    // paragraph: gather until blank line
    // Zeilen eines Absatzes fliessen zusammen (normales Markdown-Verhalten), damit
    // hart umbrochene Quelltexte nicht die Spaltenbreite vorgeben. inline() laeuft
    // erst auf dem fertigen Absatz - sonst zerreisst ein Umbruch **Fettdruck**.
    let buf = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,4}\s|>\s?|\s*[-*]\s|\s*\d+\.\s)/.test(lines[i])) {
      buf.push(lines[i].trim()); i++;
    }
    html += `<p>${inline(buf.join(" "))}</p>`;
  }
  return html;
}

/* ---------- Changelog & Docs (editierbare Karten, verschiebbar) ---------- */
let inlineEditId = null;   // id of the doc/changelog card currently in inline edit

function docCardMarkup(it, kind) {
  const editing = it.id === inlineEditId;
  const pinned = it.pinned === true;
  if (editing) {
    const isCl = kind === "changelog";
    return `
      <div class="doc-card editing${pinned?" pinned":""}" data-id="${it.id}" data-kind="${kind}">
        ${isCl ? `<div class="dc-head">
          <span class="dc-rev">Rev ${escapeHtml(String(it.rev??""))}</span>
          ${it.date ? `<span class="dc-date">${escapeHtml(it.date)}</span>` : ""}
        </div>` : ""}
        <div class="dc-edit">
          <input class="dc-edit-summary" type="text" value="${escapeHtml(it.title||"")}" placeholder="Zusammenfassung" />
          <textarea class="dc-edit-body" placeholder="Text (Markdown) — Enter speichert, Shift+Enter = neue Zeile">${escapeHtml(it.body||"")}</textarea>
          <div class="dc-edit-bar">
            <span class="dc-edit-hint">Enter speichert · Shift+Enter neue Zeile · Esc bricht ab${pinned?" · angeheftet, nicht loeschbar":""}</span>
            ${pinned ? "" : `<button class="dc-trash" title="Löschen">🗑</button>`}
            <button class="dc-save">Speichern</button>
          </div>
        </div>
      </div>`;
  }
  const isCl = kind === "changelog";
  return `
    <div class="doc-card${pinned?" pinned":""}" draggable="${pinned?"false":"true"}" data-id="${it.id}" data-kind="${kind}">
      <div class="dc-head">
        ${pinned ? `<span class="dc-pin" title="Angeheftet">📌</span>` : ""}
        ${isCl && it.rev!=null && it.rev!=="" ? `<span class="dc-rev">Rev ${escapeHtml(String(it.rev))}</span>` : ""}
        <span class="dc-title">${escapeHtml(it.title||"(ohne Titel)")}</span>
        ${isCl && it.date ? `<span class="dc-date">${escapeHtml(it.date)}</span>` : ""}
      </div>
      ${it.body ? `<div class="dc-body">${mdToHtml(it.body)}</div>` : ""}
    </div>`;
}

function renderChangelog() {
  const list = $("#changelogList");
  let items = activeAct().changelog || [];
  if (!items.length) { list.innerHTML = '<div class="empty-hint">Noch keine Einträge — „+ Eintrag“ oben.</div>'; return; }
  items = sortPinnedFirst(items);
  list.innerHTML = items.map(it => docCardMarkup(it, "changelog")).join("");
  wireDocDnD("changelog");
  wireInlineEdit("changelog");
}

function renderDocs() {
  const list = $("#docsList");
  let items = activeAct().docs || [];
  if (!items.length) { list.innerHTML = '<div class="empty-hint">Noch keine Dokumente — „+ Dokument“ oben.</div>'; return; }
  items = sortPinnedFirst(items);
  list.innerHTML = items.map(it => docCardMarkup(it, "docs")).join("");
  wireDocDnD("docs");
  wireInlineEdit("docs");
}

// Pinned entries always first, in their existing relative order; rest keep array order.
function sortPinnedFirst(items) {
  const pinned = items.filter(x => x.pinned === true);
  const rest = items.filter(x => x.pinned !== true);
  return [...pinned, ...rest];
}

function wireInlineEdit(kind) {
  const list = kind === "changelog" ? $("#changelogList") : $("#docsList");
  const arr = () => activeAct()[kind];

  // Enter edit mode on click (non-editing cards)
  list.querySelectorAll(".doc-card:not(.editing)").forEach(el => {
    el.addEventListener("click", () => { inlineEditId = el.dataset.id; render(); });
  });

  // Wire the currently editing card
  const editing = list.querySelector(".doc-card.editing");
  if (!editing) return;
  const id = editing.dataset.id;
  const summary = editing.querySelector(".dc-edit-summary");
  const body = editing.querySelector(".dc-edit-body");

  const commit = () => {
    const item = arr().find(x => x.id === id);
    if (item) { item.title = summary.value.trim(); item.body = body.value; dirty = true; }
    inlineEditId = null;
    setStatus("Gespeichert (Datei-Speichern nicht vergessen).","warn");
    render();
  };
  const cancel = () => { inlineEditId = null; render(); };

  editing.querySelector(".dc-save").addEventListener("click", commit);
  const trashBtn = editing.querySelector(".dc-trash");
  if (trashBtn) trashBtn.addEventListener("click", () => {
    const item = arr().find(x => x.id === id);
    if (item && item.pinned) return; // safety: pinned entries can't be deleted
    if (!confirm("„"+(item && item.title || "Eintrag")+"“ wirklich löschen?")) return;
    const i = arr().indexOf(item); if (i>=0) arr().splice(i,1);
    inlineEditId = null; dirty = true;
    setStatus("Gelöscht (nicht gespeichert).","warn");
    render();
  });
  // Enter saves (Shift+Enter = newline). In summary, Enter also saves.
  const onKey = e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { e.preventDefault(); cancel(); }
  };
  summary.addEventListener("keydown", onKey);
  body.addEventListener("keydown", onKey);
  // Autofocus the summary when entering edit
  summary.focus();
  summary.setSelectionRange(summary.value.length, summary.value.length);
}

let docDragId = null;
let docLastKey = null;
function wireDocDnD(kind) {
  const list = kind === "changelog" ? $("#changelogList") : $("#docsList");
  const arr = () => activeAct()[kind];

  // Per-card listeners: cards are recreated each render, so (re)bind here.
  list.querySelectorAll(".doc-card").forEach(el => {
    el.addEventListener("dragstart", e => { docDragId = el.dataset.id; el.classList.add("dragging"); e.dataTransfer.effectAllowed="move"; });
    el.addEventListener("dragend", () => { el.classList.remove("dragging"); docDragId=null; docLastKey=null; clearDocLine(); });
    // click to edit is handled by wireInlineEdit()
  });

  // Container listeners: the list element PERSISTS across renders, so bind ONCE.
  // Without this guard, every render stacks another dragover handler → severe lag.
  if (list.dataset.dndWired === "1") return;
  list.dataset.dndWired = "1";

  list.addEventListener("dragover", e => {
    e.preventDefault();
    const beforeId = docCardAfterPoint(list, e.clientY);
    const key = beforeId || "END";
    if (key !== docLastKey) { docLastKey = key; showDocLine(list, beforeId); }
  });
  list.addEventListener("dragleave", e => {
    if (!list.contains(e.relatedTarget)) { clearDocLine(); docLastKey=null; }
  });
  list.addEventListener("drop", e => {
    e.preventDefault(); clearDocLine(); docLastKey=null;
    if (!docDragId) return;
    const a = activeAct()[list.id === "changelogList" ? "changelog" : "docs"];
    const item = a.find(x => x.id === docDragId);
    if (!item) return;
    if (item.pinned) { docDragId=null; return; } // pinned can't be moved
    const beforeId = docCardAfterPoint(list, e.clientY);
    a.splice(a.indexOf(item), 1);
    if (beforeId) { const i = a.findIndex(x=>x.id===beforeId); a.splice(i<0?a.length:i, 0, item); }
    else a.push(item);
    dirty = true;
    setStatus("Neu einsortiert (nicht gespeichert).","warn");
    render();
  });
}
function docCardAfterPoint(list, y) {
  // Skip pinned cards — nothing can be dropped above a pinned entry
  const cards = [...list.querySelectorAll(".doc-card:not(.dragging):not(.pinned)")];
  for (const el of cards) { const r = el.getBoundingClientRect(); if (y < r.top + r.height/2) return el.dataset.id; }
  return null;
}
function showDocLine(list, beforeId) {
  clearDocLine();
  const line = document.createElement("div"); line.className = "drop-line"; line.id = "__docLine";
  if (beforeId) { const ref = list.querySelector(`.doc-card[data-id="${beforeId}"]`); if (ref) { list.insertBefore(line, ref); return; } }
  list.appendChild(line);
}
function clearDocLine() { const l = document.getElementById("__docLine"); if (l) l.remove(); }

/* ============================================================
   Architektur (Etappe 3c)
   Pro Act eine LISTE benannter Diagramme, jedes mit eigenem Canvas.
   Datenmodell in activeAct().architecture:
     { diagrams: [ { id, name, nodes:[...], edges:[...] } ] }
     node: { id, label, x, y, kind }   edge: { id, from, to, label }
   Migration: altes Schema { nodes, edges } -> ein Diagramm "Diagramm 1".
   Der Sidebar-Kopf "Architektur" oeffnet ein LEERES Draft-Canvas; sobald
   ein Knoten dazukommt, wird daraus ein gelistetes Diagramm.
   Canvas: World-Layer wird per translate()+scale() verschoben/gezoomt.
   Bewusst Pointer-Events (nicht die HTML5-Drag-API des Boards).
   ============================================================ */
let archDrag = null;   // { id, dx, dy, moved }  — Knoten verschieben (Welt-Koords)
let archLink = null;   // { from }               — Kante ziehen
let archPan  = null;   // { sx, sy, tx, ty }     — Canvas schieben
let archSel  = [];     // ausgewaehlte Knoten-IDs (Mehrfachauswahl)
let archBand = null, archBandRect = null;   // Rubber-Band Architektur
let mbBand   = null, mbBandRect  = null;     // Rubber-Band Moodboard
let archExpanded = true;          // Unterpunkte in der Sidebar auf/zu
let activeDiagramId = null;       // null = fluechtiges Draft-Canvas
let draftName = "";               // Name, den man dem Draft schon gibt
let archDraft = { nodes: [], edges: [] };
let viewByDiagram = {};           // id -> { tx, ty, s }  (Pan/Zoom je Diagramm, nur Laufzeit)
let subDragId = null;

const archClamp = (v, a, b) => Math.max(a, Math.min(b, v));

// architecture-Objekt des Acts holen + altes Schema migrieren.
function archData() {
  const act = activeAct();
  let a = act.architecture;
  if (!a || typeof a !== "object") a = act.architecture = {};
  if (!Array.isArray(a.diagrams)) {
    a.diagrams = [];
    if ((a.nodes && a.nodes.length) || (a.edges && a.edges.length)) {
      a.diagrams.push({ id: "d-" + Date.now().toString(36), name: "Diagramm 1",
                        nodes: a.nodes || [], edges: a.edges || [] });
    }
    delete a.nodes; delete a.edges;   // altes Schema entfernen -> JSON bleibt sauber
  }
  return a;
}

// Aktuell offenes Diagramm (oder das Draft). Faellt auf Draft zurueck,
// falls die aktive id nicht mehr existiert (z. B. geloescht).
function curDiagram() {
  if (activeDiagramId != null) {
    const d = archData().diagrams.find(x => x.id === activeDiagramId);
    if (d) return d;
    activeDiagramId = null;
  }
  return archDraft;
}

// Aus dem Draft beim ersten Inhalt ein echtes, gelistetes Diagramm machen.
function ensureDiagram() {
  if (activeDiagramId != null) return curDiagram();
  const a = archData();
  const name = (draftName && draftName.trim()) || ("Diagramm " + (a.diagrams.length + 1));
  const d = { id: "d-" + Date.now().toString(36), name, nodes: archDraft.nodes, edges: archDraft.edges };
  a.diagrams.push(d);
  viewByDiagram[d.id] = viewByDiagram["__draft"] || { tx: 0, ty: 0, s: 1 };
  activeDiagramId = d.id;
  draftName = "";
  archDraft = { nodes: [], edges: [] };
  return d;
}

/* ---------- Pan/Zoom-Sicht ---------- */
function viewKey() { return activeDiagramId || "__draft"; }
function curView() {
  const k = viewKey();
  if (!viewByDiagram[k]) viewByDiagram[k] = { tx: 0, ty: 0, s: 1 };
  return viewByDiagram[k];
}
function applyView() {
  const w = $("#archWorld"); if (!w) return;
  const v = curView();
  w.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.s})`;
}
function clampView(v) {
  v.s = archClamp(v.s, 0.3, 2.5);           // Zoom-Grenzen
  v.tx = archClamp(v.tx, -6000, 6000);      // Pan-Grenzen (praktisch "sehr gross")
  v.ty = archClamp(v.ty, -6000, 6000);
}
// Bildschirm- -> Welt-Koordinaten (unter Beruecksichtigung von Pan/Zoom).
function toWorld(clientX, clientY) {
  const r = $("#archCanvas").getBoundingClientRect();
  const v = curView();
  return { x: (clientX - r.left - v.tx) / v.s, y: (clientY - r.top - v.ty) / v.s };
}

function renderArchitecture() {
  const canvas = $("#archCanvas"), world = $("#archWorld"), svg = $("#archEdges");
  if (!canvas || !world || !svg) return;
  const dg = curDiagram();

  // Namebox (Overlay, bleibt beim Pan/Zoom fest oben links).
  const nameInput = $("#archName");
  if (nameInput) {
    if (activeDiagramId == null) { nameInput.value = draftName || ""; nameInput.placeholder = "Neues Diagramm…"; }
    else { nameInput.value = dg.name || ""; nameInput.placeholder = "Diagrammname…"; }
  }

  // Welt leeren (das <svg> bleibt als erstes Kind stehen), dann Sicht anwenden.
  world.querySelectorAll(".arch-node, .arch-edge-tag").forEach(el => el.remove());
  applyView();

  if (!dg.nodes.length) {
    svg.innerHTML = "";
    let hint = canvas.querySelector(".arch-empty");
    if (!hint) { hint = document.createElement("div"); hint.className = "empty-hint arch-empty"; canvas.appendChild(hint); }
    hint.textContent = activeDiagramId == null
      ? 'Leeres Diagramm — „+ Knoten“ oben. Der erste Knoten legt es in der Seitenleiste an.'
      : 'Leer — „+ Knoten“ oben, dann per Griff verbinden.';
    wireArchDnD();
    return;
  }
  const eh = canvas.querySelector(".arch-empty"); if (eh) eh.remove();

  dg.nodes.forEach(n => world.appendChild(archNodeEl(n)));
  drawEdges();
  wireArchDnD();
}

// Baut ein Knoten-Div inkl. Verbindungs-Griff (Position in Welt-Koords).
function archNodeEl(n) {
  const el = document.createElement("div");
  el.className = "arch-node arch-node--" + (n.kind || "box") + (archSel.includes(n.id) ? " selected" : "");
  el.dataset.id = n.id;
  el.style.left = (n.x || 0) + "px";
  el.style.top  = (n.y || 0) + "px";
  el.innerHTML =
    `<span class="arch-label">${escapeHtml(n.label || "(ohne Name)")}</span>` +
    `<span class="arch-handle" title="Ziehen = verbinden"></span>`;
  return el;
}

// Mittelpunkt eines Knotens in Welt-Koords (aus dem DOM gemessen).
function nodeCenter(id) {
  const el = $(`.arch-node[data-id="${id}"]`);
  if (!el) return null;
  return { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight / 2 };
}
// Bounding-Box eines Knotens (Zentrum + Halb-Ausdehnung) in Welt-Koords.
function nodeBox(id) {
  const el = $(`.arch-node[data-id="${id}"]`);
  if (!el) return null;
  const hw = el.offsetWidth / 2, hh = el.offsetHeight / 2;
  return { cx: el.offsetLeft + hw, cy: el.offsetTop + hh, hw, hh };
}
// Punkt auf dem Knoten-Rand in Richtung (px,py) — Pfeil endet am Rand, nicht in der Mitte.
function borderPoint(box, px, py) {
  const dx = px - box.cx, dy = py - box.cy;
  if (!dx && !dy) return { x: box.cx, y: box.cy };
  const s = 1 / Math.max(Math.abs(dx) / box.hw, Math.abs(dy) / box.hh);
  return { x: box.cx + dx * s, y: box.cy + dy * s };
}

// Kanten neu zeichnen (SVG-Linien mit Pfeilspitze + HTML-Label/Editier-Tag).
function drawEdges(extraLine) {
  const svg = $("#archEdges"), world = $("#archWorld");
  const { edges } = curDiagram();
  world.querySelectorAll(".arch-edge-tag").forEach(el => el.remove());

  let svgInner =
    `<defs><marker id="arch-arrow" viewBox="0 0 10 10" refX="9" refY="5" ` +
    `markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
    `<path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker></defs>`;

  edges.forEach(e => {
    const from = nodeBox(e.from), to = nodeBox(e.to);
    if (!from || !to) return; // haengende Kante -> ueberspringen
    const start = borderPoint(from, to.cx, to.cy);
    const end   = borderPoint(to, from.cx, from.cy);
    svgInner += `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" ` +
                `class="arch-line" marker-end="url(#arch-arrow)" />`;

    const mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2;
    const has = e.label && e.label.trim();
    const tag = document.createElement("div");
    tag.className = "arch-edge-tag" + (has ? "" : " empty");
    tag.dataset.edge = e.id;
    tag.style.left = mx + "px"; tag.style.top = my + "px";
    tag.textContent = has ? e.label : "+";
    world.appendChild(tag);
  });

  if (extraLine) {
    svgInner += `<line x1="${extraLine.x1}" y1="${extraLine.y1}" ` +
                `x2="${extraLine.x2}" y2="${extraLine.y2}" class="arch-line linking" />`;
  }
  svg.innerHTML = svgInner;
}

/* ---------- Auswahl-Rahmen, Architektur-Auswahl, Kopieren/Einfuegen ---------- */
function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// Rubber-Band-Rechteck (Bildschirm-Koords relativ zum Canvas) positionieren.
function positionBand(rect, canvasSel, sx, sy, cx, cy) {
  if (!rect) return;
  const r = $(canvasSel).getBoundingClientRect();
  rect.style.left = (Math.min(sx, cx) - r.left) + "px";
  rect.style.top = (Math.min(sy, cy) - r.top) + "px";
  rect.style.width = Math.abs(cx - sx) + "px";
  rect.style.height = Math.abs(cy - sy) + "px";
}
// Welt-Rechteck aus zwei Bildschirmpunkten (nutzt den passenden toWorld).
function bandWorldRect(toW, sx, sy, cx, cy) {
  const a = toW(Math.min(sx, cx), Math.min(sy, cy)), b = toW(Math.max(sx, cx), Math.max(sy, cy));
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}

// --- Architektur-Auswahl ---
function archApplySelection() {
  document.querySelectorAll("#archWorld .arch-node").forEach(el =>
    el.classList.toggle("selected", archSel.includes(el.dataset.id)));
}
function archBandSelect(sx, sy, cx, cy) {
  const R = bandWorldRect(toWorld, sx, sy, cx, cy);
  archSel = curDiagram().nodes.filter(n => {
    const b = nodeBox(n.id); if (!b) return false;
    return b.cx - b.hw < R.x1 && b.cx + b.hw > R.x0 && b.cy - b.hh < R.y1 && b.cy + b.hh > R.y0;
  }).map(n => n.id);
  archApplySelection();
}
function archDeleteSelection() {
  const d = curDiagram();
  d.nodes = d.nodes.filter(n => !archSel.includes(n.id));
  d.edges = (d.edges || []).filter(e => !archSel.includes(e.from) && !archSel.includes(e.to));
  archSel = []; dirty = true; setStatus("Gelöscht (nicht gespeichert).", "warn"); render();
}
function archCopyData() {
  const d = curDiagram();
  return {
    kind: "arch",
    nodes: d.nodes.filter(n => archSel.includes(n.id)).map(n => JSON.parse(JSON.stringify(n))),
    edges: (d.edges || []).filter(e => archSel.includes(e.from) && archSel.includes(e.to)).map(e => JSON.parse(JSON.stringify(e)))
  };
}
function archPasteData(data) {
  ensureDiagram();                                       // Draft ggf. in ein echtes Diagramm promoten
  const dd = curDiagram();
  const idMap = {};
  const nodes = data.nodes.map(n => {
    const nn = JSON.parse(JSON.stringify(n)); const nid = uid("n-"); idMap[n.id] = nid;
    nn.id = nid; nn.x = (nn.x || 0) + 24; nn.y = (nn.y || 0) + 24; return nn;
  });
  dd.nodes.push(...nodes);
  (data.edges || []).forEach(e => {
    if (idMap[e.from] && idMap[e.to]) dd.edges.push({ id: uid("e-"), from: idMap[e.from], to: idMap[e.to], label: e.label || "" });
  });
  archSel = nodes.map(n => n.id);
  dirty = true; setStatus(nodes.length + " eingefügt (nicht gespeichert).", "warn"); render();
}

// --- Moodboard-Rubber-Band + Kopieren/Einfuegen ---
function mbBandSelect(sx, sy, cx, cy) {
  const R = bandWorldRect(mbToWorld, sx, sy, cx, cy);
  const hit = curBoard().elements.filter(e => e.x < R.x1 && e.x + e.w > R.x0 && e.y < R.y1 && e.y + e.h > R.y0);
  const ids = new Set();
  hit.forEach(e => mbGroupMembers(e.id).forEach(id => ids.add(id)));   // Gruppen komplett
  return [...ids];
}
function mbCopyData() {
  const b = curBoard();
  return {
    kind: "mb",
    els: b.elements.filter(e => mbSel.includes(e.id)).map(e => JSON.parse(JSON.stringify(e))),
    conns: (b.connections || []).filter(c => mbSel.includes(c.from) && mbSel.includes(c.to)).map(c => JSON.parse(JSON.stringify(c)))
  };
}
function mbPasteData(data) {
  ensureBoard();
  const bb = curBoard();
  const idMap = {}, groupMap = {};
  const els = data.els.map(e => {
    const ne = JSON.parse(JSON.stringify(e)); const nid = uid("el-"); idMap[e.id] = nid;
    ne.id = nid; ne.x = (ne.x || 0) + 24; ne.y = (ne.y || 0) + 24;
    if (ne.group) { groupMap[ne.group] = groupMap[ne.group] || uid("g-"); ne.group = groupMap[ne.group]; }
    return ne;
  });
  bb.elements.push(...els);
  (data.conns || []).forEach(c => {
    if (idMap[c.from] && idMap[c.to]) {
      const nc = JSON.parse(JSON.stringify(c)); nc.id = uid("c-"); nc.from = idMap[c.from]; nc.to = idMap[c.to];
      (bb.connections = bb.connections || []).push(nc);
    }
  });
  mbSel = els.map(e => e.id); mbSelConn = null;
  dirty = true; setStatus(els.length + " eingefügt (nicht gespeichert).", "warn"); render();
}

function wireArchDnD() {
  const canvas = $("#archCanvas");

  // Pro-Knoten: Verschieben (Body) + Verbinden (Griff). Neu pro Render.
  canvas.querySelectorAll(".arch-node").forEach(el => {
    const id = el.dataset.id;

    el.querySelector(".arch-handle").addEventListener("pointerdown", e => {
      e.stopPropagation(); e.preventDefault();
      archLink = { from: id };
      setStatus("Verbinden: auf Zielknoten loslassen (daneben = abbrechen).", "");
    });

    el.addEventListener("pointerdown", e => {
      if (e.target.classList.contains("arch-handle")) return;
      if (e.button === 1) return;                        // Mittelklick -> Canvas schieben (Container)
      const node = curDiagram().nodes.find(n => n.id === id);
      if (!node) return;
      const w = toWorld(e.clientX, e.clientY);           // in Welt-Koords rechnen
      if (archSel.includes(id) && archSel.length > 1) {  // ausgewaehlte Gruppe gemeinsam verschieben
        archDrag = { id, multi: true, sx: w.x, sy: w.y, moved: false,
          items: archSel.map(sid => { const n = curDiagram().nodes.find(x => x.id === sid); return { id: sid, x0: n.x || 0, y0: n.y || 0 }; }) };
      } else {
        if (archSel.length) { archSel = []; archApplySelection(); }
        archDrag = { id, dx: w.x - (node.x || 0), dy: w.y - (node.y || 0), moved: false };
      }
      el.classList.add("dragging");
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", e => {
      if (!archDrag || archDrag.id !== id) return;
      const w = toWorld(e.clientX, e.clientY);
      if (archDrag.multi) {
        const ddx = w.x - archDrag.sx, ddy = w.y - archDrag.sy;
        if (Math.abs(ddx) > 2 || Math.abs(ddy) > 2) archDrag.moved = true;
        archDrag.items.forEach(it => {
          const n = curDiagram().nodes.find(x => x.id === it.id); if (!n) return;
          n.x = it.x0 + ddx; n.y = it.y0 + ddy;
          const dom = $(`.arch-node[data-id="${it.id}"]`);
          if (dom) { dom.style.left = n.x + "px"; dom.style.top = n.y + "px"; }
        });
        drawEdges();
      } else {
        const nx = w.x - archDrag.dx, ny = w.y - archDrag.dy;   // frei, auch negativ
        if (Math.abs(nx - el.offsetLeft) > 2 || Math.abs(ny - el.offsetTop) > 2) archDrag.moved = true;
        el.style.left = nx + "px"; el.style.top = ny + "px";
        drawEdges();
      }
    });
    el.addEventListener("pointerup", () => {
      if (archLink && archLink.from && archLink.from !== id) { addEdge(archLink.from, id); archLink = null; return; }
      if (archDrag && archDrag.id === id) {
        el.classList.remove("dragging");
        if (archDrag.multi) {
          if (archDrag.moved) { dirty = true; setStatus("Knoten verschoben (nicht gespeichert).", "warn"); }
          archDrag = null; return;
        }
        const node = curDiagram().nodes.find(n => n.id === id);
        if (node) { node.x = el.offsetLeft; node.y = el.offsetTop; }
        const wasMove = archDrag.moved;
        archDrag = null;
        if (!wasMove) { openArchEditor(id); return; }
        dirty = true;
        setStatus("Knoten verschoben (nicht gespeichert).", "warn");
      }
    });
  });

  // Container-Ebene: EINMAL binden (Guard, sonst stapeln sich Handler).
  if (canvas.dataset.archWired === "1") return;
  canvas.dataset.archWired = "1";

  // Verbinden / Pan / Rubber-Band: temporaere Vorschau dem Zeiger folgen lassen.
  canvas.addEventListener("pointermove", e => {
    if (archLink) {
      const from = nodeCenter(archLink.from); if (!from) return;
      const w = toWorld(e.clientX, e.clientY);
      drawEdges({ x1: from.x, y1: from.y, x2: w.x, y2: w.y });
    } else if (archBand) {                              // Auswahl-Rahmen aufziehen
      positionBand(archBandRect, "#archCanvas", archBand.sx, archBand.sy, e.clientX, e.clientY);
    } else if (archPan) {                               // Canvas schieben
      const v = curView();
      v.tx = archPan.tx + (e.clientX - archPan.sx);
      v.ty = archPan.ty + (e.clientY - archPan.sy);
      clampView(v); applyView();
    }
  });

  canvas.addEventListener("pointerdown", e => {
    if (archLink) return;
    if (e.button === 1) {                              // mittlere Maustaste -> Canvas schieben
      e.preventDefault();
      const v = curView();
      archPan = { sx: e.clientX, sy: e.clientY, tx: v.tx, ty: v.ty };
      canvas.classList.add("panning"); canvas.setPointerCapture(e.pointerId); return;
    }
    if (e.target.closest(".arch-node, .arch-edge-tag, .arch-name, .arch-zoom")) return;
    // linke Maustaste auf Leerflaeche -> Auswahl-Rahmen (Pan liegt auf der mittleren Taste)
    if (archSel.length) { archSel = []; archApplySelection(); }
    archBand = { sx: e.clientX, sy: e.clientY };
    archBandRect = document.createElement("div"); archBandRect.className = "arch-select-rect";
    canvas.appendChild(archBandRect);
    positionBand(archBandRect, "#archCanvas", archBand.sx, archBand.sy, e.clientX, e.clientY);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointerup", e => {
    if (archBand) {
      archBandSelect(archBand.sx, archBand.sy, e.clientX, e.clientY);
      archBandRect.remove(); archBandRect = null; archBand = null;
      setStatus(archSel.length ? archSel.length + " Knoten ausgewählt." : "", "");
    }
    if (archPan) { archPan = null; canvas.classList.remove("panning"); }
    if (archLink) { archLink = null; drawEdges(); setStatus("Verbinden abgebrochen.", ""); }
  });

  // Klick auf ein Kanten-Tag -> Kanten-Editor (aber nicht direkt nach einem Pan).
  canvas.addEventListener("click", e => {
    const tag = e.target.closest && e.target.closest(".arch-edge-tag");
    if (tag) openEdgeEditor(tag.dataset.edge);
  });

  // Zoom per Mausrad, zentriert auf den Zeiger.
  canvas.addEventListener("wheel", e => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const v = curView();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const ns = archClamp(v.s * factor, 0.3, 2.5);
    v.tx = mx - (mx - v.tx) * (ns / v.s);   // Punkt unter dem Zeiger festhalten
    v.ty = my - (my - v.ty) * (ns / v.s);
    v.s = ns;
    clampView(v); applyView();
  }, { passive: false });
}

// Zoom-Buttons (in/out zentriert, reset auf 1:1).
function archZoomBy(factor) {
  const canvas = $("#archCanvas"); if (!canvas) return;
  const r = canvas.getBoundingClientRect();
  const mx = r.width / 2, my = r.height / 2;
  const v = curView();
  const ns = archClamp(v.s * factor, 0.3, 2.5);
  v.tx = mx - (mx - v.tx) * (ns / v.s);
  v.ty = my - (my - v.ty) * (ns / v.s);
  v.s = ns;
  clampView(v); applyView();
}
function archZoomReset() { const v = curView(); v.tx = 0; v.ty = 0; v.s = 1; applyView(); }

function addEdge(from, to) {
  const dg = curDiagram();
  if (from === to) return;
  const exists = dg.edges.some(e =>
    (e.from === from && e.to === to) || (e.from === to && e.to === from));
  if (exists) { setStatus("Verbindung existiert schon.", "warn"); drawEdges(); return; }
  dg.edges.push({ id: "e-" + Date.now().toString(36), from, to, label: "" });
  dirty = true;
  setStatus("Verbunden (nicht gespeichert).", "warn");
  drawEdges();
}
function removeEdge(edgeId) {
  const dg = curDiagram();
  const i = dg.edges.findIndex(e => e.id === edgeId);
  if (i < 0) return;
  dg.edges.splice(i, 1);
  dirty = true;
  setStatus("Verbindung entfernt (nicht gespeichert).", "warn");
  drawEdges();
}

/* ---------- Kanten-Editor ---------- */
let edgeEditId = null;
function openEdgeEditor(id) {
  const edge = curDiagram().edges.find(e => e.id === id);
  if (!edge) return;
  edgeEditId = id;
  $("#eLabel").value = edge.label || "";
  $("#edgeModalBackdrop").classList.add("open");
  $("#eLabel").focus();
}
function closeEdgeEditor() { $("#edgeModalBackdrop").classList.remove("open"); edgeEditId = null; }
function saveEdgeLabel() {
  const edge = curDiagram().edges.find(e => e.id === edgeEditId);
  if (edge) edge.label = $("#eLabel").value.trim();
  dirty = true; closeEdgeEditor();
  setStatus("Verbindung übernommen (nicht gespeichert).", "warn");
  render();
}
function deleteEdgeFromEditor() {
  if (!edgeEditId) return;
  const id = edgeEditId; closeEdgeEditor();
  removeEdge(id);
}

/* ---------- Knoten-Editor ---------- */
let archEditId = null;
function openArchEditor(id) {
  archEditId = id;
  const node = id ? curDiagram().nodes.find(n => n.id === id) : null;
  $("#archModalTitle").textContent = id ? "Knoten bearbeiten" : "Neuer Knoten";
  $("#aLabel").value = node ? (node.label || "") : "";
  $("#aKind").value = node ? (node.kind || "box") : "box";
  $("#aBtnDelete").style.display = id ? "" : "none";
  $("#archModalBackdrop").classList.add("open");
  $("#aLabel").focus();
}
function closeArchEditor() { $("#archModalBackdrop").classList.remove("open"); archEditId = null; }
function saveArchNode() {
  const label = $("#aLabel").value.trim();
  if (!label) { $("#aLabel").focus(); return; }
  const kind = $("#aKind").value || "box";
  if (archEditId) {
    const node = curDiagram().nodes.find(n => n.id === archEditId);
    if (node) { node.label = label; node.kind = kind; }
  } else {
    const dg = ensureDiagram();          // Draft -> gelistetes Diagramm beim ersten Knoten
    const off = 30 + (dg.nodes.length % 6) * 26;
    dg.nodes.push({ id: "n-" + Date.now().toString(36), label, x: off, y: off, kind });
  }
  dirty = true; closeArchEditor();
  setStatus("Knoten übernommen (nicht gespeichert).", "warn");
  render();
}
function deleteArchNode() {
  if (!archEditId) return;
  const dg = curDiagram();
  const node = dg.nodes.find(n => n.id === archEditId);
  if (!confirm("Knoten „" + (node ? node.label : "") + "“ und seine Verbindungen löschen?")) return;
  dg.nodes = dg.nodes.filter(n => n.id !== archEditId);
  dg.edges = dg.edges.filter(e => e.from !== archEditId && e.to !== archEditId);
  dirty = true; closeArchEditor();
  setStatus("Knoten gelöscht (nicht gespeichert).", "warn");
  render();
}

/* ---------- Diagramm-Liste (Sidebar-Unterpunkte) ---------- */
function renderArchSubnav(view) {
  const host = $("#archSubnav");
  if (!host) return;
  const expanded = archExpanded && view === "architecture";
  host.style.display = expanded ? "" : "none";
  if (!expanded) { host.innerHTML = ""; return; }

  const diagrams = archData().diagrams;
  host.innerHTML = diagrams.length ? diagrams.map(d => `
    <div class="arch-sub ${d.id === activeDiagramId ? "active" : ""}" draggable="true" data-id="${d.id}">
      <span class="dot"></span><span class="nm">${escapeHtml(d.name || "(ohne Name)")}</span>
      <span class="sub-del" data-del="${d.id}" title="Diagramm löschen">✕</span>
    </div>`).join("")
    : '<div class="arch-sub-empty">Noch keine Diagramme.<br>„+ Knoten“ oben füllt das leere Canvas.</div>';

  host.querySelectorAll(".arch-sub").forEach(el => {
    el.addEventListener("click", e => {
      if (e.target.closest(".sub-del")) { deleteDiagram(el.dataset.id); return; }
      activeDiagramId = el.dataset.id; archSel = [];
      render();
    });
  });
  wireSubnavDnD(host);
}

function wireSubnavDnD(host) {
  host.querySelectorAll(".arch-sub").forEach(el => {
    el.addEventListener("dragstart", e => { subDragId = el.dataset.id; el.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
    el.addEventListener("dragend", () => { el.classList.remove("dragging"); subDragId = null; });
    el.addEventListener("dragover", e => e.preventDefault());
    el.addEventListener("drop", e => {
      e.preventDefault();
      if (!subDragId || subDragId === el.dataset.id) return;
      const arr = archData().diagrams;
      const from = arr.findIndex(d => d.id === subDragId);
      const to   = arr.findIndex(d => d.id === el.dataset.id);
      if (from < 0 || to < 0) return;
      const [m] = arr.splice(from, 1);
      arr.splice(to, 0, m);
      dirty = true; setStatus("Diagramme neu sortiert (nicht gespeichert).", "warn");
      render();
    });
  });
}

function deleteDiagram(id) {
  const a = archData();
  const d = a.diagrams.find(x => x.id === id);
  if (!confirm("Diagramm „" + (d ? d.name : "") + "“ mit allen Knoten/Kanten löschen?")) return;
  a.diagrams = a.diagrams.filter(x => x.id !== id);
  delete viewByDiagram[id];
  if (activeDiagramId === id) activeDiagramId = null;   // zurueck aufs Draft
  dirty = true; setStatus("Diagramm gelöscht (nicht gespeichert).", "warn");
  render();
}

/* ---------- Doc/Changelog Editor ---------- */
let docEditKind = null;   // "changelog" | "docs"
let docEditId = null;
const D = sel => document.querySelector(sel);

function openDocEditor(kind, id) {
  docEditKind = kind; docEditId = id;
  const isCl = kind === "changelog";
  const arr = activeAct()[kind] || [];
  const it = id ? arr.find(x=>x.id===id) : { title:"", body:"", rev:"", date:"" };
  D("#docModalTitle").textContent = (id ? "Bearbeiten" : "Neu") + (isCl ? " · Changelog" : " · Dokument");
  D("#dTitle").value = it.title || "";
  D("#dBody").value = it.body || "";
  D("#dRev").value = it.rev != null ? it.rev : "";
  D("#dDate").value = it.date || "";
  D("#dRevRow").style.display = isCl ? "" : "none"; // docs haben kein rev/date
  D("#dBtnDelete").style.display = id ? "" : "none";
  D("#docModalBackdrop").classList.add("open");
  D("#dTitle").focus();
}
function closeDocEditor() { D("#docModalBackdrop").classList.remove("open"); docEditId=null; docEditKind=null; }

function saveDocEntry() {
  const kind = docEditKind;
  const arr = activeAct()[kind];
  const data = { title: D("#dTitle").value.trim(), body: D("#dBody").value.trim() };
  if (kind === "changelog") {
    const rev = D("#dRev").value.trim();
    data.rev = rev === "" ? "" : (isNaN(+rev) ? rev : +rev);
    data.date = D("#dDate").value.trim();
  }
  if (!data.title && !data.body) { D("#dTitle").focus(); return; }
  if (docEditId) { Object.assign(arr.find(x=>x.id===docEditId), data); }
  else {
    data.id = (kind==="changelog"?"cl-":"doc-") + Date.now().toString(36);
    // Changelog: neue Einträge oben; Docs: unten anhängen
    if (kind === "changelog") arr.unshift(data); else arr.push(data);
  }
  dirty = true; closeDocEditor();
  setStatus("Gespeichert (nicht in Datei — „Speichern“ nicht vergessen).","warn");
  render();
}
function deleteDocEntry() {
  if (!docEditId) return;
  const arr = activeAct()[docEditKind];
  const it = arr.find(x=>x.id===docEditId);
  if (!confirm("„"+(it.title||"Eintrag")+"“ wirklich löschen?")) return;
  const i = arr.indexOf(it); if (i>=0) arr.splice(i,1);
  dirty = true; closeDocEditor();
  setStatus("Gelöscht (nicht gespeichert).","warn");
  render();
}

/* ============================================================
   Moodboard (Etappe 4a)
   Pro Act eine LISTE benannter Boards, jedes mit eigenem Canvas.
   Eigenstaendiges Modul neben der Architektur (teilt nur ein paar
   generische CSS-Klassen + archClamp). Datenmodell in act.moodboard:
     { boards: [ { id, name, elements:[...], connections:[...] } ] }
   element (ein type-Feld statt vieler Klassen):
     { id, type:"rect"|"square"|"text", x,y,w,h, layer, group,
       rect/square: fill, stroke, strokeWidth, radius
       text:        text, fontSize, fontFamily, align, color }
   connections: erst in 4b.  Frei skalierbar ueber 8 Anfasser.
   ============================================================ */
let mbExpanded = true;
let activeBoardId = null;         // null = fluechtiges Draft-Board
let mbDraftName = "";
let mbDraft = { elements: [], connections: [] };
let mbViewByBoard = {};           // id -> { tx, ty, s }
let mbSel = [];                   // ausgewaehlte Element-IDs (Mehrfachauswahl)
let mbDrag = null;                // { id, dx, dy, moved }
let mbResize = null;              // { id, handle, sx, sy, ox, oy, ow, oh }
let mbPan = null;
let mbMidPan = false;   // mittlere Maustaste gedrueckt -> Paste-Event unterdruecken (Linux middle-paste)
let mbSubDrag = null;        // Sidebar-DnD: { type:"board"|"folder", id }
let mbSubDropMode = null;    // aktuelles Drop-Ziel waehrend des Ziehens: { kind:"icon"|"line"|"folder", ... }
let mbLink = null;           // aktives Ziehen von einem Anker: { from, fromAnchor, sx, sy, moved }
let mbPending = null;        // Klick-Klick scharf: { from, fromAnchor }
let mbSelConn = null;        // ausgewaehlte Verbindung
let mbReassign = null;       // Endpunkt umhaengen: { connId, end:"from"|"to" }
let mbEpDrag = null;         // Endpunkt ziehen: { connId, end, sx, sy, moved }

const MB_FONTS = [
  { n: "Sans", v: "sans-serif" }, { n: "Serif", v: "serif" },
  { n: "Mono", v: "monospace" }, { n: "System", v: "system-ui" },
];

function mbData() {
  const act = activeAct();
  let m = act.moodboard;
  if (!m || typeof m !== "object") m = act.moodboard = {};
  if (!Array.isArray(m.boards)) m.boards = [];
  if (!Array.isArray(m.folders)) m.folders = [];   // Ordner (nicht verschachtelbar): { id, name, collapsed }
  return m;
}
function curBoard() {
  if (activeBoardId != null) {
    const b = mbData().boards.find(x => x.id === activeBoardId);
    if (b) { b.elements = b.elements || []; b.connections = b.connections || []; return b; }
    activeBoardId = null;
  }
  return mbDraft;
}
function ensureBoard() {
  if (activeBoardId != null) return curBoard();
  const m = mbData();
  const name = (mbDraftName && mbDraftName.trim()) || ("Board " + (m.boards.length + 1));
  const b = { id: "b-" + Date.now().toString(36), name, elements: mbDraft.elements, connections: mbDraft.connections };
  m.boards.push(b);
  mbViewByBoard[b.id] = mbViewByBoard["__draft"] || { tx: 0, ty: 0, s: 1 };
  activeBoardId = b.id;
  mbDraftName = "";
  mbDraft = { elements: [], connections: [] };
  return b;
}

/* ---------- Pan/Zoom (eigene Sicht je Board) ---------- */
function mbViewKey() { return activeBoardId || "__draft"; }
function mbCurView() { const k = mbViewKey(); if (!mbViewByBoard[k]) mbViewByBoard[k] = { tx: 0, ty: 0, s: 1 }; return mbViewByBoard[k]; }
function mbApplyView() { const w = $("#mbWorld"); if (!w) return; const v = mbCurView(); w.style.transform = `translate(${v.tx}px, ${v.ty}px) scale(${v.s})`; }
const MB_ZMIN = 0.15;   // weiter rauszoomen erlaubt als in der Architektur
function mbClampView(v) { v.s = archClamp(v.s, MB_ZMIN, 5); v.tx = archClamp(v.tx, -6000, 6000); v.ty = archClamp(v.ty, -6000, 6000); }
function mbToWorld(cx, cy) { const r = $("#mbCanvas").getBoundingClientRect(); const v = mbCurView(); return { x: (cx - r.left - v.tx) / v.s, y: (cy - r.top - v.ty) / v.s }; }

/* ---------- Element-Fabrik ---------- */
function mbNewElement(type) {
  const base = { id: "el-" + Date.now().toString(36), type, x: 60, y: 60, w: 170, h: 110, group: null };
  if (type === "rect")   return Object.assign(base, { fill: "#1e2a44", stroke: "#5b7cc4", strokeWidth: 2, radius: 14 });
  if (type === "square") return Object.assign(base, { w: 120, h: 120, fill: "#2a2320", stroke: "#c48a5b", strokeWidth: 2, radius: 0 });
  if (type === "text")   return Object.assign(base, { w: 190, h: 46, text: "Text", fontSize: 16, fontFamily: "sans-serif", align: "left", color: "#e8e8ea" });
  if (type === "image")  return Object.assign(base, { w: 200, h: 150, src: "" });
  if (type === "note")   return Object.assign(base, { w: 160, h: 110, stroke: "#c9a24b", strokeWidth: 2, note: "empty Note" });
  return base;
}
function mbAddElement(type) {
  const b = ensureBoard();
  const el = mbNewElement(type);
  const canvas = $("#mbCanvas");
  if (canvas) {                                   // neues Element in die Mitte der aktuellen Sicht
    const r = canvas.getBoundingClientRect();
    const c = mbToWorld(r.left + r.width / 2, r.top + r.height / 2);
    el.x = Math.round(c.x - el.w / 2); el.y = Math.round(c.y - el.h / 2);
  }
  b.elements.push(el);
  mbSel = [el.id];
  dirty = true; setStatus("Element hinzugefügt (nicht gespeichert).", "warn");
  render();
}

/* ---------- Rendern ---------- */
/* ---------- Verbindungen (Etappe 4b) ---------- */
// Bounding-Box eines Elements aus den Daten (x/y/w/h werden live gepflegt).
function mbElBox(el) { return { cx: el.x + el.w / 2, cy: el.y + el.h / 2, hw: el.w / 2, hh: el.h / 2 }; }

// Exakte Position eines Ankers (n/e/s/w) am Element, in Welt-Koords.
function mbAnchorPoint(el, anchor) {
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  if (anchor === "n") return { x: cx, y: el.y };
  if (anchor === "s") return { x: cx, y: el.y + el.h };
  if (anchor === "w") return { x: el.x, y: cy };
  if (anchor === "e") return { x: el.x + el.w, y: cy };
  return { x: cx, y: cy };
}
// Naechstgelegener Anker eines Elements zu einem Welt-Punkt.
function mbNearestAnchor(el, p) {
  let best = "n", bd = Infinity;
  ["n", "e", "s", "w"].forEach(a => {
    const q = mbAnchorPoint(el, a), dx = q.x - p.x, dy = q.y - p.y, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = a; }
  });
  return best;
}
// Zielelement + Anker unter einem Bildschirmpunkt (Anker exakt, falls auf einem Kreis; sonst der naechste).
function mbTargetAt(clientX, clientY, excludeId) {
  const node = document.elementFromPoint(clientX, clientY); if (!node) return null;
  const elmEl = node.closest && node.closest(".mb-el"); if (!elmEl) return null;
  const id = elmEl.dataset.id; if (id === excludeId) return null;
  const el = curBoard().elements.find(x => x.id === id); if (!el) return null;
  const conn = node.closest(".mb-c");
  return { id, anchor: conn ? conn.dataset.anchor : mbNearestAnchor(el, mbToWorld(clientX, clientY)) };
}

// Auswaerts-Richtung eines Ankers (fuer perpendikulaere Stubs).
function mbDir(a) { return a === "n" ? { x: 0, y: -1 } : a === "s" ? { x: 0, y: 1 } : a === "e" ? { x: 1, y: 0 } : { x: -1, y: 0 }; }
// Schneidet ein achsenparalleles Segment ein Rechteck?
function segHitsRect(p, q, r) {
  if (p.y === q.y) { const y = p.y, x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x); return y >= r.y0 && y <= r.y1 && x1 >= r.x0 && x0 <= r.x1; }
  if (p.x === q.x) { const x = p.x, y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y); return x >= r.x0 && x <= r.x1 && y1 >= r.y0 && y0 <= r.y1; }
  return false;
}
function pathHitsAny(pts, rects) {
  for (let i = 0; i < pts.length - 1; i++) for (const r of rects) if (segHitsRect(pts[i], pts[i + 1], r)) return true;
  return false;
}
// "Intelligente" Route: perpendikulaerer Stub an beiden Enden, dann orthogonal;
// aus mehreren Kandidaten den ersten waehlen, der keine Fremd-Box kreuzt.
function mbSmartPath(p1, a1, p2, a2, rects) {
  const S = 26, M = 14, d1 = mbDir(a1), d2 = mbDir(a2);
  const s1 = { x: p1.x + d1.x * S, y: p1.y + d1.y * S };
  const s2 = { x: p2.x + d2.x * S, y: p2.y + d2.y * S };
  const mx = (s1.x + s2.x) / 2, my = (s1.y + s2.y) / 2;
  const cands = [
    [p1, s1, { x: s2.x, y: s1.y }, s2, p2],                 // H zuerst
    [p1, s1, { x: s1.x, y: s2.y }, s2, p2],                 // V zuerst
    [p1, s1, { x: mx, y: s1.y }, { x: mx, y: s2.y }, s2, p2], // Mitte-X
    [p1, s1, { x: s1.x, y: my }, { x: s2.x, y: my }, s2, p2], // Mitte-Y
  ];
  // Umwege ums Hindernisfeld, falls die direkten Routen kreuzen.
  if (rects.length) {
    const bx0 = Math.min(...rects.map(r => r.x0)) - M, bx1 = Math.max(...rects.map(r => r.x1)) + M;
    const by0 = Math.min(...rects.map(r => r.y0)) - M, by1 = Math.max(...rects.map(r => r.y1)) + M;
    cands.push([p1, s1, { x: s1.x, y: by0 }, { x: s2.x, y: by0 }, s2, p2]);   // oben herum
    cands.push([p1, s1, { x: s1.x, y: by1 }, { x: s2.x, y: by1 }, s2, p2]);   // unten herum
    cands.push([p1, s1, { x: bx0, y: s1.y }, { x: bx0, y: s2.y }, s2, p2]);   // links herum
    cands.push([p1, s1, { x: bx1, y: s1.y }, { x: bx1, y: s2.y }, s2, p2]);   // rechts herum
  }
  const best = cands.find(c => !pathHitsAny(c, rects)) || cands[2];
  return "M " + best.map(pt => `${(+pt.x).toFixed(1)} ${(+pt.y).toFixed(1)}`).join(" L ");
}

// Pfad-Geometrie je Stil zwischen zwei Randpunkten.
function mbPathD(p1, p2, style) {
  if (style === "elbow") {   // Knicklinie: orthogonal ueber die dominante Achse
    const dx = Math.abs(p2.x - p1.x), dy = Math.abs(p2.y - p1.y);
    if (dx >= dy) { const mx = (p1.x + p2.x) / 2; return `M ${p1.x} ${p1.y} L ${mx} ${p1.y} L ${mx} ${p2.y} L ${p2.x} ${p2.y}`; }
    const my = (p1.y + p2.y) / 2; return `M ${p1.x} ${p1.y} L ${p1.x} ${my} L ${p2.x} ${my} L ${p2.x} ${p2.y}`;
  }
  if (style === "wave") {    // Wellenkurve: Sinus quer zur Verbindung, Endpunkte liegen auf dem Rand
    const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;               // Normale
    const amp = Math.min(16, len / 10), humps = Math.max(2, Math.round(len / 70)), steps = humps * 8;
    let d = `M ${p1.x} ${p1.y}`;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, bx = p1.x + dx * t, by = p1.y + dy * t, off = Math.sin(t * Math.PI * humps) * amp;
      d += ` L ${(bx + nx * off).toFixed(1)} ${(by + ny * off).toFixed(1)}`;
    }
    return d;
  }
  return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;   // gerade
}

// Alle Verbindungen zeichnen (SVG-Pfade) + klickbares Mittel-Tag je Verbindung.
// extra (optional) = temporaere Linie beim Ziehen einer neuen Verbindung.
function drawMbConnections(extra) {
  const svg = $("#mbEdges"), world = $("#mbWorld"); if (!svg || !world) return;
  const b = curBoard();
  world.querySelectorAll(".mb-conn-tag, .mb-ep").forEach(t => t.remove());

  let inner = `<defs><marker id="mb-arrow" viewBox="0 0 10 10" refX="9" refY="5" ` +
    `markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
    `<path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker></defs>`;

  const byId = id => b.elements.find(e => e.id === id);
  // Hindernis-Rechtecke (leicht aufgeblasen) fuer die intelligente Route.
  const elRects = (b.elements || []).map(e => ({ id: e.id, x0: e.x - 8, y0: e.y - 8, x1: e.x + e.w + 8, y1: e.y + e.h + 8 }));
  (b.connections || []).forEach(c => {
    const A = byId(c.from), B = byId(c.to); if (!A || !B) return;
    // Endpunkte an den gemerkten Ankern; alte Verbindungen ohne Anker -> Rand (wie zuvor).
    const p1 = c.fromAnchor ? mbAnchorPoint(A, c.fromAnchor) : borderPoint(mbElBox(A), B.x + B.w / 2, B.y + B.h / 2);
    const p2 = c.toAnchor ? mbAnchorPoint(B, c.toAnchor) : borderPoint(mbElBox(B), A.x + A.w / 2, A.y + A.h / 2);
    const ms = c.arrowFrom ? ' marker-start="url(#mb-arrow)"' : '';
    const me = c.arrowTo ? ' marker-end="url(#mb-arrow)"' : '';
    const sel = c.id === mbSelConn ? " selected" : "";
    const st = `stroke:${c.color || "#8a93a6"};stroke-width:${c.width || 2}`;   // Pfeil erbt Farbe via context-stroke
    const dPath = (c.style === "smart" && c.fromAnchor && c.toAnchor)
      ? mbSmartPath(p1, c.fromAnchor, p2, c.toAnchor, elRects.filter(r => r.id !== c.from && r.id !== c.to))
      : mbPathD(p1, p2, c.style || "straight");
    inner += `<path d="${dPath}" class="mb-conn${sel}" fill="none" style="${st}"${ms}${me} />`;
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    const tag = document.createElement("div");
    tag.className = "mb-conn-tag" + (c.id === mbSelConn ? " active" : "");
    tag.dataset.conn = c.id;
    tag.style.left = mx + "px"; tag.style.top = my + "px";
    world.appendChild(tag);

    // Endpunkt-Griffe an der ausgewaehlten Verbindung -> anklickbar zum Umhaengen.
    if (c.id === mbSelConn) {
      [["from", p1], ["to", p2]].forEach(([end, pt]) => {
        const ep = document.createElement("div");
        ep.className = "mb-ep" + (mbReassign && mbReassign.connId === c.id && mbReassign.end === end ? " armed" : "");
        ep.dataset.ep = end; ep.dataset.conn = c.id;
        ep.style.left = pt.x + "px"; ep.style.top = pt.y + "px";
        ep.addEventListener("pointerdown", e => {
          if (e.button === 1) return;
          e.stopPropagation(); e.preventDefault();
          mbEpDrag = { connId: c.id, end, sx: e.clientX, sy: e.clientY, moved: false };
        });
        world.appendChild(ep);
      });
    }
  });
  if (extra) inner += `<path d="M ${extra.x1} ${extra.y1} L ${extra.x2} ${extra.y2}" class="mb-conn linking" fill="none" />`;
  svg.innerHTML = inner;
}

function addConnection(from, fromAnchor, to, toAnchor) {
  const b = curBoard();
  if (from === to) return;
  b.connections = b.connections || [];
  const exists = b.connections.some(c =>
    (c.from === from && c.to === to) || (c.from === to && c.to === from));
  if (exists) { setStatus("Verbindung existiert schon.", "warn"); drawMbConnections(); return; }
  b.connections.push({ id: "c-" + Date.now().toString(36), from, fromAnchor, to, toAnchor, arrowFrom: false, arrowTo: true, style: "straight", color: "#8a93a6", width: 2 });
  dirty = true; setStatus("Verbunden (nicht gespeichert).", "warn");
  drawMbConnections();
}
function mbDeleteConnection(id) {
  const b = curBoard();
  b.connections = (b.connections || []).filter(c => c.id !== id);
  if (mbSelConn === id) mbSelConn = null;
  dirty = true; setStatus("Verbindung entfernt (nicht gespeichert).", "warn");
  render();
}
function mbSelectConn(id) {
  mbSel = []; mbSelConn = id; mbReassign = null;
  const world = $("#mbWorld");
  if (world) world.querySelectorAll(".mb-el").forEach(e => { e.classList.remove("selected"); e.style.cursor = ""; });
  drawMbConnections();
  mbRenderPanel();
}
function mbDeselectAll() { mbSel = []; mbSelConn = null; mbReassign = null; mbApplySelection(); drawMbConnections(); }

// Neuen Anker fuer den scharfen Endpunkt setzen (Start oder Ziel umhaengen).
function mbReassignApply(elId, anchor) {
  const c = (curBoard().connections || []).find(x => x.id === mbReassign.connId);
  if (c) {
    const other = mbReassign.end === "from" ? c.to : c.from;
    if (elId === other) { setStatus("Start und Ziel müssen verschiedene Elemente sein.", "warn"); }
    else {
      if (mbReassign.end === "from") { c.from = elId; c.fromAnchor = anchor; }
      else { c.to = elId; c.toAnchor = anchor; }
      dirty = true; setStatus("Anker neu gesetzt (nicht gespeichert).", "warn");
    }
  }
  mbReassign = null;
  drawMbConnections();
}

function renderMoodboard() {
  const canvas = $("#mbCanvas"), world = $("#mbWorld");
  if (!canvas || !world) return;
  const b = curBoard();

  const nm = $("#mbName");
  if (nm) {
    if (activeBoardId == null) { nm.value = mbDraftName || ""; nm.placeholder = "Neues Board…"; }
    else { nm.value = b.name || ""; nm.placeholder = "Board-Name…"; }
  }
  const snapChk = $("#mbSnapChk"); if (snapChk) snapChk.checked = state.meta.mbSnap !== false;
  const gcol = $("#mbGuideCol"); if (gcol) gcol.value = state.meta.mbGuideColor || "#ff4d8d";

  world.querySelectorAll(".mb-el").forEach(el => el.remove());
  mbApplyView();
  mbClearGuides();
  if (mbNoteOpenId != null && !b.elements.some(e => e.id === mbNoteOpenId)) mbCloseNote();

  if (!b.elements.length) {
    let hint = canvas.querySelector(".mb-empty");
    if (!hint) { hint = document.createElement("div"); hint.className = "empty-hint mb-empty"; canvas.appendChild(hint); }
    hint.textContent = activeBoardId == null
      ? 'Leeres Board — oben ein Element wählen. Das erste legt es in der Seitenleiste an.'
      : 'Leer — oben ein Element hinzufügen.';
  } else {
    const eh = canvas.querySelector(".mb-empty"); if (eh) eh.remove();
    // nach layer sortiert einfuegen: hoehere Ebene spaeter im DOM = im Vordergrund
    // z-Reihenfolge = Array-Reihenfolge (spaeter = weiter vorne).
    b.elements.forEach(el => world.appendChild(mbElementEl(el)));
  }

  wireMbDnD();
  drawMbConnections();
  mbApplySelection();   // Auswahl + Anfasser + Panel (auch leer -> alles weg)
}

function mbElementEl(el) {
  const d = document.createElement("div");
  d.className = "mb-el mb-el--" + el.type + (el.type === "image" && el.crop ? " cropped" : "");
  d.dataset.id = el.id;
  d.style.left = el.x + "px"; d.style.top = el.y + "px";
  d.style.width = el.w + "px"; d.style.height = el.h + "px";
  if (el.type === "rect" || el.type === "square") {
    d.style.background = el.fill || "transparent";
    d.style.border = (el.strokeWidth || 0) + "px solid " + (el.stroke || "transparent");
    d.style.borderRadius = (el.radius || 0) + "px";
    if (el.label != null && el.label !== "") {             // eingebettetes, mittig zentriertes Label
      const lab = document.createElement("div");
      lab.className = "mb-shape-label";
      lab.style.fontSize = (el.labelFontSize || 16) + "px";
      lab.style.fontFamily = el.labelFontFamily || "sans-serif";
      lab.style.color = el.labelColor || "#ffffff";
      lab.innerHTML = mbSanitizeHtml(el.label);
      d.appendChild(lab);
    }
  } else if (el.type === "text") {
    d.style.color = el.color || "var(--ink)";
    d.style.fontSize = (el.fontSize || 16) + "px";
    d.style.fontFamily = el.fontFamily || "sans-serif";
    d.style.textAlign = el.align || "left";
    const t = document.createElement("div");
    t.className = "mb-text";
    if (el.html != null) t.innerHTML = mbSanitizeHtml(el.html);   // Rich-Text (mehrfarbig) – beim Rendern erneut absichern
    else t.textContent = el.text || "";
    d.appendChild(t);
  } else if (el.type === "image") {
    if (el.crop) d.style.overflow = "hidden";          // Rahmen clippt das groessere Bild; Kreis-Clip liegt im Wrapper
    d.appendChild(mbBuildImageInner(el));
  } else if (el.type === "note") {
    d.style.background = "transparent";
    d.style.border = (el.strokeWidth || 2) + "px dashed " + (el.stroke || "#c9a24b");
    d.style.borderRadius = "4px";
    const pin = document.createElement("div");            // Pin oben rechts, ausserhalb der Ecke
    pin.className = "mb-note-pin"; pin.title = "Notiz öffnen"; pin.textContent = "📌";
    d.appendChild(pin);
    wireNotePin(d, pin, el.id);
  }
  // Verbinder-Kreise: immer im DOM (via CSS bei Hover/Auswahl sichtbar) -> Anker bleiben verfuegbar
  ["n", "e", "s", "w"].forEach(pos => {
    const c = document.createElement("div");
    c.className = "mb-c mb-c-" + pos; c.dataset.anchor = pos;
    c.title = "Ziehen oder klicken = verbinden";
    d.appendChild(c);
    wireConnector(d, c);
  });
  return d;
}

// Auswahl anwenden (Mehrfach), ohne die Elemente neu zu bauen (Doppelklick-Edit bleibt heil).
function mbApplySelection() {
  const world = $("#mbWorld");
  if (world) {
    world.querySelectorAll(".mb-group-box").forEach(x => x.remove());
    world.querySelectorAll(".mb-el").forEach(elm => {
      elm.classList.toggle("selected", mbSel.includes(elm.dataset.id));
      elm.style.cursor = "";   // Kanten-Cursor zuruecksetzen; Hover setzt ihn bei Einzelauswahl neu
    });
    // Auswahl-Rahmen um eine Mehrfach-/Gruppenauswahl
    if (mbSel.length > 1) {
      const els = mbSel.map(id => curBoard().elements.find(x => x.id === id)).filter(Boolean);
      if (els.length) {
        const x0 = Math.min(...els.map(e => e.x)), y0 = Math.min(...els.map(e => e.y));
        const x1 = Math.max(...els.map(e => e.x + e.w)), y1 = Math.max(...els.map(e => e.y + e.h));
        const box = document.createElement("div");
        box.className = "mb-group-box";
        box.style.left = (x0 - 6) + "px"; box.style.top = (y0 - 6) + "px";
        box.style.width = (x1 - x0 + 12) + "px"; box.style.height = (y1 - y0 + 12) + "px";
        world.appendChild(box);
      }
    }
  }
  mbRenderPanel();
}
function mbSetSelection(ids) {
  mbSel = [...new Set(ids)];
  if (mbSel.length) mbSelConn = null;
  mbApplySelection();
}
function mbUpdateGroupBox() {
  const box = $(".mb-group-box"); if (!box) return;
  const els = mbSel.map(id => curBoard().elements.find(x => x.id === id)).filter(Boolean);
  if (!els.length) return;
  const x0 = Math.min(...els.map(e => e.x)), y0 = Math.min(...els.map(e => e.y));
  const x1 = Math.max(...els.map(e => e.x + e.w)), y1 = Math.max(...els.map(e => e.y + e.h));
  box.style.left = (x0 - 6) + "px"; box.style.top = (y0 - 6) + "px";
  box.style.width = (x1 - x0 + 12) + "px"; box.style.height = (y1 - y0 + 12) + "px";
}

/* ---------- Smart-Guides / Einrasten (Etappe 5) ---------- */
// Snap-Ziele: ungruppierte Elemente einzeln; jede Gruppe als EINE Bounding-Box
// (so rastet man an einer Gruppe wie an einem Objekt ein). Bewegte IDs ausgeschlossen.
function mbSnapTargets(movingIds) {
  const b = curBoard();
  const groups = {}, rects = [];
  b.elements.forEach(e => {
    if (movingIds.includes(e.id)) return;
    if (e.group) {
      const g = groups[e.group] || (groups[e.group] = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
      g.x0 = Math.min(g.x0, e.x); g.y0 = Math.min(g.y0, e.y);
      g.x1 = Math.max(g.x1, e.x + e.w); g.y1 = Math.max(g.y1, e.y + e.h);
    } else {
      rects.push({ x: e.x, y: e.y, w: e.w, h: e.h });
    }
  });
  Object.values(groups).forEach(g => rects.push({ x: g.x0, y: g.y0, w: g.x1 - g.x0, h: g.y1 - g.y0 }));
  return rects;
}
// Prueft die 3 markanten Linien der bewegten Auswahl (links/mitte/rechts, oben/mitte/unten)
// gegen dieselben Linien aller Snap-Ziele. Liefert Korrektur (dx,dy) + Hilfslinien.
function mbComputeSnap(drag, ddx, ddy) {
  const b = curBoard();
  const movingIds = drag.items.map(it => it.id);
  // Vorlaeufige Bounding-Box der bewegten Auswahl
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  drag.items.forEach(it => {
    const el = b.elements.find(x => x.id === it.id); if (!el) return;
    const x = it.x0 + ddx, y = it.y0 + ddy;
    bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x + el.w); by1 = Math.max(by1, y + el.h);
  });
  if (!isFinite(bx0)) return { dx: 0, dy: 0, guides: [] };

  const mX = [bx0, (bx0 + bx1) / 2, bx1];   // markante x-Linien der Auswahl
  const mY = [by0, (by0 + by1) / 2, by1];   // markante y-Linien der Auswahl
  const T = 6 / mbCurView().s;              // Schwelle ~6 Bildschirm-px in Welt-Einheiten

  let bX = null, bY = null;                 // beste Treffer je Achse
  const targets = mbSnapTargets(movingIds); // gruppierte Elemente = eine Bounding-Box
  targets.forEach(r => {
    const sX = [r.x, r.x + r.w / 2, r.x + r.w], sY = [r.y, r.y + r.h / 2, r.y + r.h];
    mX.forEach(m => sX.forEach(s => { const d = Math.abs(m - s); if (d <= T && (!bX || d < bX.d)) bX = { d, at: s, span: [Math.min(by0, r.y), Math.max(by1, r.y + r.h)] }; }));
    mY.forEach(m => sY.forEach(s => { const d = Math.abs(m - s); if (d <= T && (!bY || d < bY.d)) bY = { d, at: s, span: [Math.min(bx0, r.x), Math.max(bx1, r.x + r.w)] }; }));
  });

  const guides = []; let dx = 0, dy = 0;
  if (bX) {
    const m = mX.reduce((best, v) => Math.abs(v - bX.at) < Math.abs(best - bX.at) ? v : best, mX[0]);
    dx = bX.at - m;                          // Auswahl auf die Fremdlinie schieben
    guides.push({ x1: bX.at, y1: bX.span[0], x2: bX.at, y2: bX.span[1] });
  }
  if (bY) {
    const m = mY.reduce((best, v) => Math.abs(v - bY.at) < Math.abs(best - bY.at) ? v : best, mY[0]);
    dy = bY.at - m;
    guides.push({ x1: bY.span[0], y1: bY.at, x2: bY.span[1], y2: bY.at });
  }

  // Equi-Spacing: gleiche Abstaende vorschlagen — je Achse nur, wenn dort nicht schon ausgerichtet.
  if (!bY) {
    const sp = mbSpacingAxis(by0, by1, bx0, bx1, targets, r => ({ lo: r.y, hi: r.y + r.h, plo: r.x, phi: r.x + r.w }));
    if (sp) { dy += sp.delta; const X = (bx0 + bx1) / 2; sp.bars.forEach(g => guides.push({ spacing: true, axis: "y", pos: X, a: g[0], b: g[1] })); }
  }
  if (!bX) {
    const sp = mbSpacingAxis(bx0, bx1, by0, by1, targets, r => ({ lo: r.x, hi: r.x + r.w, plo: r.y, phi: r.y + r.h }));
    if (sp) { dx += sp.delta; const Y = (by0 + by1) / 2; sp.bars.forEach(g => guides.push({ spacing: true, axis: "x", pos: Y, a: g[0], b: g[1] })); }
  }
  return { dx, dy, guides };
}

// Equi-Spacing auf EINER Achse: findet eine Position, die einen bestehenden Abstand wiederholt
// (unter/ueber der Reihe) oder mittig zwischen zwei Nachbarn liegt. get(e) -> {lo,hi,plo,phi}.
// Liefert { delta, bars:[[lo,hi],[lo,hi]] } (die beiden gleichen Luecken) oder null.
function mbSpacingAxis(mLo, mHi, mPerpLo, mPerpHi, statics, get) {
  const mSize = mHi - mLo;
  const nb = statics.map(get)
    .filter(n => n.phi > mPerpLo && n.plo < mPerpHi)     // ueberlappt senkrecht (gleiche Spalte/Zeile)
    .sort((a, b) => a.lo - b.lo);
  if (nb.length < 2) return null;
  const T = 6 / mbCurView().s;
  let best = null;
  const consider = (targetLo, bars) => {
    const d = targetLo - mLo;
    if (Math.abs(d) <= T && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, bars };
  };
  // Abstand der letzten zwei Nachbarn unter die Reihe wiederholen
  const gL = nb[nb.length - 1].lo - nb[nb.length - 2].hi;
  if (gL > 0) { const t = nb[nb.length - 1].hi + gL; consider(t, [[nb[nb.length - 2].hi, nb[nb.length - 1].lo], [nb[nb.length - 1].hi, t]]); }
  // Abstand der ersten zwei Nachbarn ueber die Reihe wiederholen
  const gF = nb[1].lo - nb[0].hi;
  if (gF > 0) { const t = nb[0].lo - gF - mSize; consider(t, [[nb[0].hi, nb[1].lo], [t + mSize, nb[0].lo]]); }
  // mittig zwischen ein Nachbarpaar setzen (gleiche Luecke oben/unten)
  for (let i = 0; i < nb.length - 1; i++) {
    const space = nb[i + 1].lo - nb[i].hi;
    if (space >= mSize) { const t = nb[i].hi + (space - mSize) / 2; consider(t, [[nb[i].hi, t], [t + mSize, nb[i + 1].lo]]); }
  }
  return best;
}
// Hilfslinien in #mbGuides zeichnen. Ausrichtung = gestrichelte Linie; Abstand = durchgezogener
// Balken mit Endkappen. Welt-Koords, konstante Strichbreite via non-scaling-stroke.
function mbDrawGuides(guides) {
  const svg = $("#mbGuides"); if (!svg) return;
  const col = (state.meta && state.meta.mbGuideColor) || "#ff4d8d";
  const cap = 5 / mbCurView().s;
  const L = (x1, y1, x2, y2, dash) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="2" ${dash ? 'stroke-dasharray="6 5" ' : ""}vector-effect="non-scaling-stroke" />`;
  let out = "";
  (guides || []).forEach(g => {
    if (g.spacing) {
      if (g.axis === "y") {                              // senkrechter Abstandsbalken bei x=pos
        out += L(g.pos, g.a, g.pos, g.b, false) + L(g.pos - cap, g.a, g.pos + cap, g.a, false) + L(g.pos - cap, g.b, g.pos + cap, g.b, false);
      } else {                                           // waagerechter Abstandsbalken bei y=pos
        out += L(g.a, g.pos, g.b, g.pos, false) + L(g.a, g.pos - cap, g.a, g.pos + cap, false) + L(g.b, g.pos - cap, g.b, g.pos + cap, false);
      }
    } else {
      out += L(g.x1, g.y1, g.x2, g.y2, true);
    }
  });
  svg.innerHTML = out;
}
function mbClearGuides() { const svg = $("#mbGuides"); if (svg) svg.innerHTML = ""; }
// Rich-Text absichern: nur harmlose Formatierungs-Tags/-Styles durchlassen (Farbe je Wort bleibt).
// Alles andere (script, Attribute, Event-Handler, Bilder...) wird verworfen -> sicher fuer innerHTML/JSON.
const MB_RT_TAGS = new Set(["SPAN", "B", "STRONG", "I", "EM", "U", "S", "BR", "DIV", "P", "FONT"]);
const MB_RT_DROP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "OBJECT", "EMBED", "SVG", "LINK", "META"]);
const MB_RT_STYLES = ["color", "background-color", "font-weight", "font-style", "text-decoration", "text-align"];
function mbSanitizeHtml(html) {
  const src = document.createElement("div");
  src.innerHTML = html || "";
  const clean = node => {
    if (node.nodeType === 3) return document.createTextNode(node.nodeValue);      // Text
    if (node.nodeType !== 1) return null;                                         // Kommentare etc. raus
    if (MB_RT_DROP.has(node.tagName)) return null;                                // Tag + Inhalt komplett verwerfen
    let out;
    if (MB_RT_TAGS.has(node.tagName)) {
      out = document.createElement(node.tagName === "FONT" ? "span" : node.tagName.toLowerCase());
      if (node.tagName === "FONT" && node.getAttribute("color")) out.style.color = node.getAttribute("color");
      MB_RT_STYLES.forEach(p => { const v = node.style && node.style.getPropertyValue(p); if (v) out.style.setProperty(p, v); });
    } else {
      out = document.createDocumentFragment();                                    // unbekanntes Tag auspacken, Inhalt behalten
    }
    node.childNodes.forEach(ch => { const c = clean(ch); if (c) out.appendChild(c); });
    return out;
  };
  const wrap = document.createElement("div");
  src.childNodes.forEach(ch => { const c = clean(ch); if (c) wrap.appendChild(c); });
  return wrap.innerHTML;
}

/* ---------- Rich-Text-Editieren + schwebende Toolbar ---------- */
let mbEditId = null, mbEditNode = null, mbEditRange = null, mbEditLabel = false;
// CSS-Farbe (rgb()/hex) -> #rrggbb fuer das Farbfeld.
function mbRgbToHex(c) {
  if (!c) return null;
  if (c[0] === "#") return c.length === 4 ? "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c.slice(0, 7);
  const m = c.match(/\d+(\.\d+)?/g); if (!m || m.length < 3) return null;
  return "#" + m.slice(0, 3).map(n => Math.round(+n).toString(16).padStart(2, "0")).join("");
}
// Aktuelle Auswahl/Formatierung ins Modell schreiben (live waehrend des Editierens).
function mbCommitEdit() {
  if (mbEditId == null || !mbEditNode) return;
  const el = curBoard().elements.find(x => x.id === mbEditId); if (!el) return;
  if (mbEditLabel) {                               // Label auf Rechteck/Quadrat (Leer-Handling beim Verlassen)
    el.label = mbSanitizeHtml(mbEditNode.innerHTML); dirty = true; return;
  }
  el.text = mbEditNode.textContent;
  const rich = mbSanitizeHtml(mbEditNode.innerHTML);
  el.html = rich.indexOf("<") < 0 ? null : rich;   // reiner Text -> kein html-Ballast
  dirty = true;
}
// Singleton-Toolbar am body.
function mbTextToolbar() {
  let tb = document.getElementById("mbTextTb");
  if (tb) return tb;
  tb = document.createElement("div");
  tb.id = "mbTextTb"; tb.className = "mb-text-tb";
  tb.innerHTML =
    `<button data-cmd="bold" title="Fett"><b>B</b></button>` +
    `<button data-cmd="italic" title="Kursiv"><i>I</i></button>` +
    `<button data-cmd="underline" title="Unterstrichen"><u>U</u></button>` +
    `<span class="mb-tb-sep"></span>` +
    `<button data-cmd="justifyLeft" title="Linksbündig">⯇</button>` +
    `<button data-cmd="justifyCenter" title="Zentriert">≡</button>` +
    `<button data-cmd="justifyRight" title="Rechtsbündig">⯈</button>` +
    `<span class="mb-tb-sep"></span>` +
    `<input type="number" class="mb-tb-size" id="mbTbSize" min="8" max="96" title="Schriftgröße">` +
    `<select class="mb-tb-font" id="mbTbFont" title="Schriftart">${MB_FONTS.map(f => `<option value="${f.v}">${f.n}</option>`).join("")}</select>` +
    `<label class="mb-tb-color" title="Textfarbe">A<input type="color" id="mbTbColor"></label>`;
  document.body.appendChild(tb);
  // Buttons duerfen den Fokus NICHT stehlen -> Auswahl im Editor bleibt erhalten.
  // Ausnahme: Farb-, Groessen- und Schrift-Regler duerfen den Fokus bekommen (wirken aufs ganze Element).
  tb.addEventListener("mousedown", e => { if (!e.target.closest("input[type=color], .mb-tb-size, .mb-tb-font")) e.preventDefault(); });
  tb.querySelectorAll("button[data-cmd]").forEach(b => b.addEventListener("click", () => {
    if (!mbEditNode) return;
    document.execCommand("styleWithCSS", false, true);
    document.execCommand(b.dataset.cmd);
    mbEditNode.focus(); mbCommitEdit(); mbUpdateTextToolbar();
  }));
  const ci = tb.querySelector("#mbTbColor");
  ci.addEventListener("input", () => {
    if (!mbEditNode) return;
    mbEditNode.focus();
    if (mbEditRange) { const s = getSelection(); s.removeAllRanges(); s.addRange(mbEditRange); }
    document.execCommand("styleWithCSS", false, true);
    document.execCommand("foreColor", false, ci.value);
    mbCommitEdit();
  });
  // Schriftgroesse + Schriftart wirken auf das GANZE Textelement (bzw. das Label).
  const si = tb.querySelector("#mbTbSize");
  si.addEventListener("input", () => {
    if (mbEditId == null) return;
    const el = curBoard().elements.find(x => x.id === mbEditId); if (!el) return;
    const size = parseInt(si.value) || 16;
    if (mbEditLabel) { el.labelFontSize = size; if (mbEditNode) mbEditNode.style.fontSize = size + "px"; }
    else { el.fontSize = size; mbUpdateElementStyle(el); }
    dirty = true; histTouch();
  });
  const fo = tb.querySelector("#mbTbFont");
  fo.addEventListener("change", () => {
    if (mbEditId == null) return;
    const el = curBoard().elements.find(x => x.id === mbEditId); if (!el) return;
    if (mbEditLabel) { el.labelFontFamily = fo.value; if (mbEditNode) mbEditNode.style.fontFamily = fo.value; }
    else { el.fontFamily = fo.value; mbUpdateElementStyle(el); }
    dirty = true; histTouch();
  });
  return tb;
}
function mbShowTextToolbar(elm) {
  const tb = mbTextToolbar(); tb.style.display = "flex";
  const el = mbEditId != null ? curBoard().elements.find(x => x.id === mbEditId) : null;
  if (el) {                                                      // Groesse/Schrift ins Toolbar-Feld
    const si = tb.querySelector("#mbTbSize"); if (si) si.value = (mbEditLabel ? el.labelFontSize : el.fontSize) || 16;
    const fo = tb.querySelector("#mbTbFont"); if (fo) fo.value = (mbEditLabel ? el.labelFontFamily : el.fontFamily) || "sans-serif";
  }
  const r = elm.getBoundingClientRect();
  const w = Math.max(430, Math.round(r.width));                 // breit genug fuer alle Regler
  tb.style.width = w + "px";
  tb.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + "px";
  let top = r.top - tb.offsetHeight - 8;
  if (top < 8) top = r.bottom + 8;                              // kein Platz oben -> darunter
  tb.style.top = top + "px";
}
function mbHideTextToolbar() { const tb = document.getElementById("mbTextTb"); if (tb) tb.style.display = "none"; }
function mbUpdateTextToolbar() {
  const tb = document.getElementById("mbTextTb"); if (!tb || mbEditId == null) return;
  try {
    const col = mbRgbToHex(document.queryCommandValue("foreColor"));   // Farbe am Cursor
    if (col) tb.querySelector("#mbTbColor").value = col;
    ["bold", "italic", "underline"].forEach(c =>
      tb.querySelector(`[data-cmd="${c}"]`).classList.toggle("on", document.queryCommandState(c)));
  } catch (e) { /* queryCommand kann in Randfaellen werfen */ }
}
// Label auf Rechteck/Quadrat editieren (mittig zentriert, waechst mit dem Text, keine eigenen Anfasser).
function mbEnterLabelEdit(id, elm) {
  const el = curBoard().elements.find(x => x.id === id); if (!el || (el.type !== "rect" && el.type !== "square")) return;
  const hadLabel = el.label != null && el.label !== "";
  if (!hadLabel) {                                    // Default anlegen
    el.label = "Neuer Text";
    if (el.labelFontSize == null) el.labelFontSize = 16;
    if (el.labelFontFamily == null) el.labelFontFamily = "sans-serif";
    if (el.labelColor == null) el.labelColor = "#ffffff";
  }
  let lab = elm.querySelector(".mb-shape-label");     // Label-Knoten sicherstellen
  if (!lab) {
    lab = document.createElement("div"); lab.className = "mb-shape-label";
    lab.style.fontSize = (el.labelFontSize || 16) + "px";
    lab.style.fontFamily = el.labelFontFamily || "sans-serif";
    lab.style.color = el.labelColor || "#ffffff";
    lab.innerHTML = mbSanitizeHtml(el.label);
    elm.appendChild(lab);
  }
  elm.classList.add("editing");
  lab.contentEditable = "true"; lab.style.pointerEvents = "auto"; lab.focus();
  document.execCommand("styleWithCSS", false, true);
  mbEditId = id; mbEditNode = lab; mbEditRange = null; mbEditLabel = true;
  if (!hadLabel) {                                    // frischer Default -> alles auswaehlen, Tippen ersetzt ihn
    const s = getSelection(), rng = document.createRange();
    rng.selectNodeContents(lab); s.removeAllRanges(); s.addRange(rng);
  }
  mbShowTextToolbar(elm); mbUpdateTextToolbar();

  const onPaste = ev => {
    ev.preventDefault(); const cd = ev.clipboardData; if (!cd) return;
    const html = cd.getData("text/html");
    if (html) document.execCommand("insertHTML", false, mbSanitizeHtml(html));
    else document.execCommand("insertText", false, cd.getData("text/plain"));
    mbCommitEdit();
  };
  const finish = () => {
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", onKey, true);
    lab.removeEventListener("paste", onPaste);
    const plain = lab.textContent.replace(/\u00a0/g, " ").trim();
    if (plain === "") {                               // komplett leer -> Label verschwindet
      el.label = null; delete el.labelFontSize; delete el.labelFontFamily; delete el.labelColor;
      lab.remove(); setStatus("Text entfernt (nicht gespeichert).", "warn");
    } else {
      const rich = mbSanitizeHtml(lab.innerHTML);
      el.label = rich; lab.innerHTML = rich; setStatus("Text geändert (nicht gespeichert).", "warn");
    }
    dirty = true;
    lab.contentEditable = "false"; lab.style.pointerEvents = ""; elm.classList.remove("editing");
    mbHideTextToolbar();
    mbEditId = null; mbEditNode = null; mbEditRange = null; mbEditLabel = false;
    histTouch();
  };
  const outside = ev => {                             // Klick ausserhalb Label/Toolbar -> speichern & beenden
    if (ev.target.closest && (ev.target.closest(".mb-el.editing") || ev.target.closest(".mb-text-tb"))) return;
    finish();
  };
  const onKey = ev => { if (ev.key === "Escape") { ev.preventDefault(); finish(); } };   // Escape speichert
  lab.addEventListener("paste", onPaste);
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("keydown", onKey, true);
}

// Alle Mitglieder der Gruppe eines Elements (oder nur das Element selbst).
function mbGroupMembers(id) {
  const el = curBoard().elements.find(x => x.id === id);
  if (el && el.group) return curBoard().elements.filter(x => x.group === el.group).map(x => x.id);
  return [id];
}
// Gemeinsame Gruppen-ID der Auswahl, falls alle dieselbe (sonst null).
function mbGroupOf(ids) {
  const els = ids.map(id => curBoard().elements.find(x => x.id === id)).filter(Boolean);
  if (!els.length) return null;
  const g = els[0].group;
  return (g && els.every(e => e.group === g)) ? g : null;
}
function mbGroupSelection() {
  const gid = "g-" + Date.now().toString(36);
  mbSel.forEach(id => { const e = curBoard().elements.find(x => x.id === id); if (e) e.group = gid; });
  dirty = true; setStatus("Gruppiert (nicht gespeichert).", "warn"); mbApplySelection();
}
function mbUngroupSelection() {
  mbSel.forEach(id => { const e = curBoard().elements.find(x => x.id === id); if (e) e.group = null; });
  dirty = true; setStatus("Gruppierung gelöst (nicht gespeichert).", "warn"); mbApplySelection();
}
// Nach vorne = ans Ende der Liste (zuletzt gerendert = oben); nach hinten = an den Anfang.
function mbReorder(toFront) {
  const b = curBoard();
  const sel = b.elements.filter(e => mbSel.includes(e.id));   // relative Reihenfolge bleibt erhalten
  const rest = b.elements.filter(e => !mbSel.includes(e.id));
  b.elements = toFront ? [...rest, ...sel] : [...sel, ...rest];
  dirty = true; setStatus(toFront ? "In den Vordergrund." : "In den Hintergrund.", "warn"); render();
}
// Eine Ebene weiter: ausgewaehlte Elemente je einen Schritt nach vorne/hinten tauschen (an Nicht-Ausgewaehlten).
function mbReorderOne(toFront) {
  if (!mbSel.length) return;
  const els = curBoard().elements, sel = new Set(mbSel);
  if (toFront) {                                              // von oben nach unten, damit mehrere zusammen wandern
    for (let i = els.length - 2; i >= 0; i--)
      if (sel.has(els[i].id) && !sel.has(els[i + 1].id)) { [els[i], els[i + 1]] = [els[i + 1], els[i]]; }
  } else {
    for (let i = 1; i < els.length; i++)
      if (sel.has(els[i].id) && !sel.has(els[i - 1].id)) { [els[i], els[i - 1]] = [els[i - 1], els[i]]; }
  }
  dirty = true; setStatus(toFront ? "Eine Ebene nach vorne." : "Eine Ebene nach hinten.", "warn"); render();
}
function mbDeleteSelection() {
  const b = curBoard();
  b.elements = b.elements.filter(e => !mbSel.includes(e.id));
  b.connections = (b.connections || []).filter(c => !mbSel.includes(c.from) && !mbSel.includes(c.to));
  mbSel = []; dirty = true; setStatus("Gelöscht (nicht gespeichert).", "warn"); render();
  // Bilddateien werden hier NICHT geloescht: das waere nicht umkehrbar (Undo) und wuerde geteilte
  // Kopien brechen. Nicht mehr referenzierte Bilder raeumt erst der Speichern-Vorgang auf (mbGcImages).
}
// Nicht mehr referenzierte Bilddateien aus docs/images/ entfernen. Laeuft beim Speichern.
// Reference-Counting: eine Datei wird erst geloescht, wenn KEIN Element (in keinem Act/Board) mehr
// auf sie zeigt. Dadurch bleibt Loeschen umkehrbar und geteilte Kopien brechen nie. Best-effort.
async function mbGcImages() {
  try {
    if (!mbDirHandle) return;
    if ((await mbDirHandle.queryPermission({ mode: "readwrite" })) !== "granted") return;
    const used = new Set();
    (state.acts || []).forEach(a => {
      const mb = a.moodboard;
      if (!mb || !Array.isArray(mb.boards)) return;
      mb.boards.forEach(b => (b.elements || []).forEach(el => {
        if (el.type === "image" && el.src) used.add(el.src.split("/").pop());
      }));
    });
    const imagesDir = await mbDirHandle.getDirectoryHandle("images", { create: false }).catch(() => null);
    if (!imagesDir) return;
    const orphans = [];
    for await (const [name, handle] of imagesDir.entries()) {
      if (handle.kind === "file" && !used.has(name)) orphans.push(name);
    }
    for (const name of orphans) { try { await imagesDir.removeEntry(name); } catch {} }
    if (orphans.length) setStatus(orphans.length + " ungenutzte Bilddatei(en) aufgeräumt.", "ok");
  } catch { /* GC ist best-effort */ }
}
// Verbinderpunkt: Ziehen ODER Klick-Klick (Startanker klicken, dann Zielanker klicken).
function wireConnector(elm, c) {
  c.addEventListener("pointerdown", e => {
    if (e.button === 1) return;                          // mittlere Taste -> Canvas schieben
    e.stopPropagation(); e.preventDefault();
    const from = elm.dataset.id, fromAnchor = c.dataset.anchor;
    if (mbReassign) { mbReassignApply(from, fromAnchor); return; }   // Endpunkt umhaengen
    // Klick-Klick-Abschluss: bereits ein Startanker scharf und dies ist ein anderes Element.
    if (mbPending && mbPending.from !== from) {
      addConnection(mbPending.from, mbPending.fromAnchor, from, fromAnchor);
      mbPending = null; mbLink = null; return;
    }
    mbPending = null;                                   // frischer Start
    mbLink = { from, fromAnchor, sx: e.clientX, sy: e.clientY, moved: false };
  });
}

/* ---------- Interaktion ---------- */
function wireMbDnD() {
  const canvas = $("#mbCanvas");

  canvas.querySelectorAll(".mb-el").forEach(elm => {
    const id = elm.dataset.id;

    // Body: auswaehlen + verschieben
    elm.addEventListener("pointerdown", e => {
      if (e.button === 1) return;                        // mittlere Taste -> Canvas schieben (Container)
      if (e.button === 2) return;                        // rechte Taste -> Kontextmenue (kein Drag/keine Auswahl)
      if (e.target.closest(".mb-c")) return;             // Verbinder haben Vorrang
      if (elm.classList.contains("editing")) return;      // beim Text-Editieren nicht draggen
      if (elm.classList.contains("cropping")) return;     // beim Zuschneiden nicht draggen/resizen
      const el = curBoard().elements.find(x => x.id === id); if (!el) return;
      // Kanten-Resize: bei Einzelauswahl an der Aussenkante ziehen (statt verschieben)
      if (!mbReassign && !mbPending && mbSel.length === 1 && mbSel[0] === id) {
        const z = mbEdgeZone(elm, e.clientX, e.clientY);
        if (z) {
          e.stopPropagation(); e.preventDefault();
          mbResize = { id, handle: z, sx: e.clientX, sy: e.clientY, ox: el.x, oy: el.y, ow: el.w, oh: el.h };
          elm.setPointerCapture(e.pointerId);
          return;
        }
      }
      if (mbReassign) { mbReassignApply(id, mbNearestAnchor(el, mbToWorld(e.clientX, e.clientY))); return; }
      // Klick-Klick-Abschluss auf den Element-Body -> naechster Anker dieses Elements
      if (mbPending && mbPending.from !== id) {
        addConnection(mbPending.from, mbPending.fromAnchor, id, mbNearestAnchor(el, mbToWorld(e.clientX, e.clientY)));
        mbPending = null; return;
      }
      mbPending = null;
      // Auswahl-Logik: Shift = umschalten; sonst Element ODER seine ganze Gruppe waehlen.
      const already = mbSel.includes(id);
      if (e.shiftKey) {
        mbSetSelection(already ? mbSel.filter(x => x !== id) : [...mbSel, id]);
        if (!mbSel.includes(id)) return;                 // eben abgewaehlt -> nicht draggen
      } else if (!already) {
        mbSetSelection(mbGroupMembers(id));
      }
      // Verschieben: alle aktuell ausgewaehlten Elemente gemeinsam.
      const w = mbToWorld(e.clientX, e.clientY);
      mbDrag = {
        anchorId: id, sx: w.x, sy: w.y, moved: false,
        items: mbSel.map(sid => { const s = curBoard().elements.find(x => x.id === sid); return { id: sid, x0: s.x, y0: s.y }; })
      };
      elm.classList.add("dragging");
      elm.setPointerCapture(e.pointerId);
    });
    elm.addEventListener("pointermove", e => {
      // Kanten-Resize aktiv? -> Groesse anpassen (gegenueberliegende Kante bleibt fest)
      if (mbResize && mbResize.id === id) {
        const v = mbCurView();
        const dx = (e.clientX - mbResize.sx) / v.s, dy = (e.clientY - mbResize.sy) / v.s;
        const el = curBoard().elements.find(x => x.id === id); if (!el) return;
        applyResize(el, mbResize, dx, dy);
        elm.style.left = el.x + "px"; elm.style.top = el.y + "px";
        elm.style.width = el.w + "px"; elm.style.height = el.h + "px";
        drawMbConnections();
        return;
      }
      if (!mbDrag || mbDrag.anchorId !== id) return;
      const w = mbToWorld(e.clientX, e.clientY);
      let ddx = w.x - mbDrag.sx, ddy = w.y - mbDrag.sy;
      if (Math.abs(ddx) > 2 || Math.abs(ddy) > 2) mbDrag.moved = true;
      // Smart-Guides: Einrasten + Hilfslinien (Alt haelt es an)
      const snapOn = (state.meta.mbSnap !== false) && !e.altKey;
      let guides = [];
      if (snapOn) { const sn = mbComputeSnap(mbDrag, ddx, ddy); ddx += sn.dx; ddy += sn.dy; guides = sn.guides; }
      mbDrag.items.forEach(it => {
        const s = curBoard().elements.find(x => x.id === it.id); if (!s) return;
        s.x = Math.round(it.x0 + ddx); s.y = Math.round(it.y0 + ddy);
        const dom = $(`.mb-el[data-id="${it.id}"]`);
        if (dom) { dom.style.left = s.x + "px"; dom.style.top = s.y + "px"; }
      });
      mbDrawGuides(guides);
      drawMbConnections();
      mbUpdateGroupBox();                                // Auswahlrahmen mitziehen
    });
    elm.addEventListener("pointerup", () => {
      if (mbResize && mbResize.id === id) { mbResize = null; dirty = true; setStatus("Größe geändert (nicht gespeichert).", "warn"); return; }
      if (mbDrag && mbDrag.anchorId === id) {
        elm.classList.remove("dragging");
        if (mbDrag.moved) { dirty = true; setStatus("Verschoben (nicht gespeichert).", "warn"); }
        mbDrag = null;
        mbClearGuides();
      }
    });
    elm.addEventListener("pointerleave", () => { if (!mbResize) elm.style.cursor = ""; });

    // Text: Doppelklick -> inline editieren
    elm.addEventListener("dblclick", e => {
      const el = curBoard().elements.find(x => x.id === id);
      if (!el) return;
      if (el.type === "image") { e.stopPropagation(); mbEnterCrop(id, elm); return; }   // Bild -> Zuschneiden
      if (el.type === "rect" || el.type === "square") {                                  // Rechteck/Quadrat -> Label
        if (elm.classList.contains("editing")) return;    // schon im Label-Edit -> nicht neu anlegen
        e.stopPropagation(); mbEnterLabelEdit(id, elm); return;
      }
      if (el.type !== "text") return;
      if (elm.classList.contains("editing")) return;      // schon im Edit -> native Wort-/Absatzauswahl
      e.stopPropagation();
      const t = elm.querySelector(".mb-text"); if (!t) return;
      elm.classList.add("editing");
      mbEditId = id; mbEditNode = t; mbEditRange = null; mbEditLabel = false;
      t.contentEditable = "true"; t.focus();
      document.execCommand("styleWithCSS", false, true);
      // Nur das Wort unter dem Doppelklick auswaehlen (nicht mehr den ganzen Text).
      const cr = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
      const s = getSelection();
      if (cr) { s.removeAllRanges(); s.addRange(cr); s.modify("move", "backward", "word"); s.modify("extend", "forward", "word"); }
      mbShowTextToolbar(elm); mbUpdateTextToolbar();

      const onPaste = ev => {                             // Rich-Text-Paste (abgesichert, mehrfarbig bleibt)
        ev.preventDefault();
        const cd = ev.clipboardData; if (!cd) return;
        const html = cd.getData("text/html");
        if (html) { document.execCommand("insertHTML", false, mbSanitizeHtml(html)); }
        else { document.execCommand("insertText", false, cd.getData("text/plain")); }
        mbCommitEdit();
      };
      const finish = () => {
        document.removeEventListener("pointerdown", outside, true);
        document.removeEventListener("keydown", onKey, true);
        t.removeEventListener("paste", onPaste);
        mbCommitEdit();
        t.contentEditable = "false"; elm.classList.remove("editing");
        if (el.html != null) t.innerHTML = el.html; else t.textContent = el.text || "";  // Anzeige = gespeicherter Stand
        mbHideTextToolbar();
        mbEditId = null; mbEditNode = null; mbEditRange = null;
        setStatus("Text geändert (nicht gespeichert).", "warn");
      };
      const outside = ev => {                             // Klick ausserhalb Editor/Toolbar -> beenden
        if (ev.target.closest && (ev.target.closest(".mb-el.editing") || ev.target.closest(".mb-text-tb"))) return;
        finish();
      };
      const onKey = ev => { if (ev.key === "Escape") { ev.preventDefault(); finish(); } };
      t.addEventListener("paste", onPaste);
      document.addEventListener("pointerdown", outside, true);
      document.addEventListener("keydown", onKey, true);
    });
  });

  // Container-Ebene: EINMAL binden.
  if (canvas.dataset.mbWired === "1") return;
  canvas.dataset.mbWired = "1";

  // Rechtsklick -> eigenes Kontextmenue (Objekt unter dem Zeiger wird ausgewaehlt, falls noch nicht).
  canvas.addEventListener("contextmenu", e => {
    if (currentView() !== "moodboard") return;
    e.preventDefault();
    const elm = e.target.closest(".mb-el");
    if (elm) { const id = elm.dataset.id; if (!mbSel.includes(id)) mbSetSelection(mbGroupMembers(id)); }
    mbOpenContextMenu(e.clientX, e.clientY);
  });
  // Menue schliessen: Klick ausserhalb, Escape, Fensterwechsel.
  document.addEventListener("pointerdown", e => { if (!(e.target.closest && e.target.closest("#mbCtxMenu"))) mbHideCtx(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") mbHideCtx(); });
  window.addEventListener("blur", mbHideCtx);
  // Zuschneiden: Klick ausserhalb des Bildes/der Crop-Toolbar beendet + speichert.
  document.addEventListener("pointerdown", e => {
    if (mbCropId == null) return;
    if (e.target.closest && (e.target.closest(".mb-el.cropping") || e.target.closest("#mbCropTb"))) return;
    mbExitCrop(true);
  });

  // Bilddateien vom Rechner direkt aufs Board ziehen -> skalieren + speichern (wie Paste), am Drop-Punkt.
  const dropHi = on => { canvas.style.outline = on ? "2px dashed var(--accent)" : ""; canvas.style.outlineOffset = on ? "-2px" : ""; };
  canvas.addEventListener("dragover", e => {
    if (!(e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files"))) return;
    e.preventDefault(); dropHi(true);
  });
  canvas.addEventListener("dragleave", e => { if (!canvas.contains(e.relatedTarget)) dropHi(false); });
  canvas.addEventListener("drop", async e => {
    if (!(e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files"))) return;
    e.preventDefault(); dropHi(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
    if (!files.length) { setStatus("Keine Bilddatei im Drop.", "warn"); return; }
    if (!IS_HOSTED) {                                    // gehostet uebernimmt mbInsertImageHosted den Upload
      const dir = await mbEnsureDir();                   // Ordner einmal sichern (Drop ist eine Geste)
      if (!dir) { setStatus("Kein Ordnerzugriff — Bilder nicht gespeichert.", "warn"); return; }
    }
    for (let i = 0; i < files.length; i++)
      await mbInsertImage(files[i], { x: e.clientX + i * 24, y: e.clientY + i * 24 });
  });

  canvas.addEventListener("pointerdown", e => {
    if (e.button === 1) {                              // mittlere Maustaste -> immer Canvas schieben
      e.preventDefault();
      mbMidPan = true;                                 // Paste-Event dieses Klicks unterdruecken
      const v = mbCurView();
      mbPan = { sx: e.clientX, sy: e.clientY, tx: v.tx, ty: v.ty };
      canvas.classList.add("panning");
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.target.closest(".mb-el, .mb-conn-tag, .mb-ep, .arch-name, .arch-zoom, .mb-panel")) return;
    if (e.button === 2) return;                          // rechte Taste -> Kontextmenue (Auswahl bleibt erhalten)
    // Resize von AUSSEN: Zeiger nahe der Aussenkante des einzeln gewaehlten Elements -> skalieren (statt abwaehlen/Rahmen)
    if (mbSel.length === 1 && !mbReassign && !mbPending) {
      const rid = mbSel[0], relm = canvas.querySelector(`.mb-el[data-id="${rid}"]`);
      if (relm && !relm.classList.contains("editing") && !relm.classList.contains("cropping")) {
        const z = mbEdgeZone(relm, e.clientX, e.clientY);
        if (z) {
          const el = curBoard().elements.find(x => x.id === rid);
          if (el) {
            e.preventDefault();
            mbResize = { id: rid, handle: z, sx: e.clientX, sy: e.clientY, ox: el.x, oy: el.y, ow: el.w, oh: el.h };
            relm.setPointerCapture(e.pointerId);
            return;
          }
        }
      }
    }
    if (mbReassign) { mbReassign = null; setStatus("Umhängen abgebrochen.", ""); }
    if (mbPending) { mbPending = null; setStatus("Verbinden abgebrochen.", ""); }
    if (mbSel.length || mbSelConn != null) mbDeselectAll();   // Leerflaeche -> abwaehlen
    // linke Maustaste auf Leerflaeche -> Auswahl-Rahmen (Pan liegt auf der mittleren Taste)
    mbBand = { sx: e.clientX, sy: e.clientY };
    mbBandRect = document.createElement("div"); mbBandRect.className = "mb-select-rect";
    canvas.appendChild(mbBandRect);
    positionBand(mbBandRect, "#mbCanvas", mbBand.sx, mbBand.sy, e.clientX, e.clientY);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", e => {
    if (!mbResize && !mbDrag && !mbPan && !mbBand && !mbLink && !mbEpDrag) mbHoverEdgeCursor(canvas, e);
    if (mbEpDrag) {                                     // Endpunkt ziehen -> Vorschau vom festen Ende
      if (Math.abs(e.clientX - mbEpDrag.sx) > 3 || Math.abs(e.clientY - mbEpDrag.sy) > 3) mbEpDrag.moved = true;
      const conn = (curBoard().connections || []).find(x => x.id === mbEpDrag.connId);
      if (conn) {
        const fixEnd = mbEpDrag.end === "from" ? "to" : "from";
        const fixEl = curBoard().elements.find(x => x.id === conn[fixEnd]);
        const fa = mbEpDrag.end === "from" ? conn.toAnchor : conn.fromAnchor;
        if (fixEl) {
          const pt = fa ? mbAnchorPoint(fixEl, fa) : { x: fixEl.x + fixEl.w / 2, y: fixEl.y + fixEl.h / 2 };
          const w = mbToWorld(e.clientX, e.clientY);
          drawMbConnections({ x1: pt.x, y1: pt.y, x2: w.x, y2: w.y });
        }
      }
      return;
    }
    if (mbLink) {                                       // temporaere Linie vom Startanker zum Zeiger
      if (Math.abs(e.clientX - mbLink.sx) > 3 || Math.abs(e.clientY - mbLink.sy) > 3) mbLink.moved = true;
      const A = curBoard().elements.find(x => x.id === mbLink.from); if (!A) return;
      const p = mbAnchorPoint(A, mbLink.fromAnchor), w = mbToWorld(e.clientX, e.clientY);
      drawMbConnections({ x1: p.x, y1: p.y, x2: w.x, y2: w.y });
      return;
    }
    if (mbBand) { positionBand(mbBandRect, "#mbCanvas", mbBand.sx, mbBand.sy, e.clientX, e.clientY); return; }
    if (!mbPan) return;
    const v = mbCurView();
    v.tx = mbPan.tx + (e.clientX - mbPan.sx);
    v.ty = mbPan.ty + (e.clientY - mbPan.sy);
    mbClampView(v); mbApplyView();
  });
  canvas.addEventListener("pointerup", e => {
    if (mbBand) {
      const sel = mbBandSelect(mbBand.sx, mbBand.sy, e.clientX, e.clientY);
      mbBandRect.remove(); mbBandRect = null; mbBand = null;
      if (sel.length) mbSetSelection(sel);
      else mbApplySelection();
    }
    if (mbPan) { mbPan = null; canvas.classList.remove("panning"); }
    if (mbMidPan) setTimeout(() => { mbMidPan = false; }, 60);   // Paste-Event kann kurz nachlaufen
    if (mbEpDrag) {
      const d = mbEpDrag; mbEpDrag = null;
      const conn = (curBoard().connections || []).find(x => x.id === d.connId);
      if (d.moved) {                                    // gezogen -> Ziel bestimmen und umhaengen
        const other = conn ? (d.end === "from" ? conn.to : conn.from) : null;
        const t = mbTargetAt(e.clientX, e.clientY, other);
        if (t && conn) {
          if (d.end === "from") { conn.from = t.id; conn.fromAnchor = t.anchor; }
          else { conn.to = t.id; conn.toAnchor = t.anchor; }
          dirty = true; setStatus("Anker neu gesetzt (nicht gespeichert).", "warn");
        } else { setStatus("Umhängen abgebrochen.", ""); }
        mbReassign = null; drawMbConnections();
      } else {                                          // reiner Klick -> Klick-Klick scharf
        mbReassign = { connId: d.connId, end: d.end };
        drawMbConnections();
        setStatus("Neuen Anker anklicken (Verbinderkreis oder Zielelement). Esc bricht ab.", "");
      }
      return;
    }
    if (mbLink) {
      if (mbLink.moved) {                               // Ziehen beendet -> Ziel + Anker bestimmen
        const t = mbTargetAt(e.clientX, e.clientY, mbLink.from);
        if (t) { addConnection(mbLink.from, mbLink.fromAnchor, t.id, t.anchor); }
        else { drawMbConnections(); setStatus("Verbinden abgebrochen.", ""); }
        mbPending = null;
      } else {                                          // reiner Klick auf Startanker -> Klick-Klick scharf
        mbPending = { from: mbLink.from, fromAnchor: mbLink.fromAnchor };
        setStatus("Zielanker (oder Zielelement) anklicken. Esc bricht ab.", "");
      }
      mbLink = null;
    }
  });
  canvas.addEventListener("click", e => {
    const tag = e.target.closest && e.target.closest(".mb-conn-tag");
    if (tag) mbSelectConn(tag.dataset.conn);
  });
  canvas.addEventListener("wheel", e => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const v = mbCurView();
    const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const ns = archClamp(v.s * f, MB_ZMIN, 2.5);
    v.tx = mx - (mx - v.tx) * (ns / v.s);
    v.ty = my - (my - v.ty) * (ns / v.s);
    v.s = ns; mbClampView(v); mbApplyView();
  }, { passive: false });
}

// Randzone unter dem Cursor: "" (innen/weit weg) oder "n"/"s"/"e"/"w"/"nw"/"ne"/"sw"/"se".
// TIN = Innen-Streifen (Greifen von innen), TOUT = Aussen-Reichweite (Cursor erscheint schon vor der Kante).
// TIN nie groesser als ein Drittel der Seite, sonst bleibt bei kleinen Objekten keine Innenflaeche zum Verschieben.
const MB_EDGE_CURSOR = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize" };
function mbEdgeZone(elm, clientX, clientY) {
  const r = elm.getBoundingClientRect();
  const TIN = Math.min(9, r.width / 3, r.height / 3);
  const TOUT = 12;
  if (clientX < r.left - TOUT || clientX > r.right + TOUT || clientY < r.top - TOUT || clientY > r.bottom + TOUT) return "";
  const nearL = clientX <= r.left + TIN, nearR = clientX >= r.right - TIN;
  const nearT = clientY <= r.top + TIN, nearB = clientY >= r.bottom - TIN;
  let z = "";
  if (nearT) z = "n"; else if (nearB) z = "s";
  if (nearL) z += "w"; else if (nearR) z += "e";
  return z;
}
// Cursor an der Aussenkante des einzeln gewaehlten Elements setzen — auf Canvas-Ebene, damit es
// auch greift, waehrend der Zeiger noch AUSSERHALB der Element-Box ist (Elemente bekommen dort keine Events).
function mbHoverEdgeCursor(canvas, e) {
  const single = mbSel.length === 1 ? mbSel[0] : null;
  if (!single) { canvas.style.cursor = ""; return; }
  const elm = canvas.querySelector(`.mb-el[data-id="${single}"]`);
  if (!elm || elm.classList.contains("editing") || elm.classList.contains("cropping")) { canvas.style.cursor = ""; return; }
  if (e.target.closest(".mb-c")) { canvas.style.cursor = ""; return; }   // Verbinder -> eigener Cursor (Fadenkreuz)
  const z = mbEdgeZone(elm, e.clientX, e.clientY);
  canvas.style.cursor = z ? MB_EDGE_CURSOR[z] : "";     // greift, wenn der Zeiger auf der Leerflaeche ist
  elm.style.cursor = z ? MB_EDGE_CURSOR[z] : "grab";    // greift, wenn der Zeiger ueber dem Element ist
}
// Anfasser -> neue x/y/w/h; gegenueberliegende Kante bleibt fest, Mindestgroesse 24.
function applyResize(el, r, dx, dy) {
  const MIN = 24;
  let x = r.ox, y = r.oy, w = r.ow, hh = r.oh, h = r.handle;
  if (h.includes("e")) w = r.ow + dx;
  if (h.includes("s")) hh = r.oh + dy;
  if (h.includes("w")) { w = r.ow - dx; x = r.ox + dx; }
  if (h.includes("n")) { hh = r.oh - dy; y = r.oy + dy; }
  if (w < MIN) { if (h.includes("w")) x = r.ox + (r.ow - MIN); w = MIN; }
  if (hh < MIN) { if (h.includes("n")) y = r.oy + (r.oh - MIN); hh = MIN; }
  if (el.crop) {                                         // Zuschnitt mitskalieren, damit der Bildinhalt mitwaechst
    const rw = w / r.ow, rh = hh / r.oh;
    el.crop.fullW = Math.round(el.crop.fullW * rw); el.crop.fullH = Math.round(el.crop.fullH * rh);
    el.crop.ox = Math.round(el.crop.ox * rw); el.crop.oy = Math.round(el.crop.oy * rh);
  }
  el.x = Math.round(x); el.y = Math.round(y); el.w = Math.round(w); el.h = Math.round(hh);
}

/* ---------- Eigenschaften-Panel ---------- */
function mbField(label, inner) { return `<label class="mb-p-row"><span>${label}</span>${inner}</label>`; }

function mbRenderPanel() {
  const p = $("#mbPanel"); if (!p) return;

  // Verbindung ausgewaehlt -> Stil/Pfeile/Loeschen
  if (mbSelConn != null) {
    const c = (curBoard().connections || []).find(x => x.id === mbSelConn);
    if (!c) { mbSelConn = null; p.style.display = "none"; p.innerHTML = ""; return; }
    p.style.display = "";
    p.innerHTML = `<div class="mb-p-title">Verbindung</div>`
      + mbField("Stil", `<select data-c="style">${[["straight", "Gerade"], ["wave", "Welle"], ["elbow", "Knick"], ["smart", "Intelligent"]].map(([v, n]) => `<option value="${v}" ${c.style === v ? "selected" : ""}>${n}</option>`).join("")}</select>`)
      + mbField("Linienfarbe", `<input type="color" data-c="color" value="${c.color || "#8a93a6"}">`)
      + mbField("Liniendicke", `<input type="number" min="1" max="12" data-c="width" value="${c.width || 2}">`)
      + `<label class="mb-p-check"><input type="checkbox" data-c="arrowFrom" ${c.arrowFrom ? "checked" : ""}> Pfeil am Start</label>`
      + `<label class="mb-p-check"><input type="checkbox" data-c="arrowTo" ${c.arrowTo ? "checked" : ""}> Pfeil am Ende</label>`
      + `<button class="danger mb-p-del">Verbindung löschen</button>`;
    p.querySelectorAll("[data-c]").forEach(inp => {
      inp.addEventListener("input", () => {
        const val = inp.type === "checkbox" ? inp.checked : inp.type === "number" ? (parseInt(inp.value) || 1) : inp.value;
        c[inp.dataset.c] = val;
        dirty = true; drawMbConnections();
      });
    });
    p.querySelector(".mb-p-del").addEventListener("click", () => mbDeleteConnection(c.id));
    return;
  }

  if (!mbSel.length) { p.style.display = "none"; p.innerHTML = ""; return; }
  p.style.display = "";

  // Mehrfachauswahl -> Gruppieren/Loesen, Ebene, Loeschen
  if (mbSel.length > 1) {
    const grouped = mbGroupOf(mbSel) != null;
    p.innerHTML = `<div class="mb-p-title">${mbSel.length} Elemente</div>`
      + `<button class="tool mb-p-wide" data-act="${grouped ? "ungroup" : "group"}">${grouped ? "Gruppierung lösen" : "Gruppieren"}</button>`
      + `<div class="mb-p-row"><span>Ebene</span><span class="mb-p-lay"><button class="tool" data-act="front">Vorder</button><button class="tool" data-act="back">Hinter</button></span></div>`
      + `<button class="danger mb-p-del">Auswahl löschen</button>`;
    p.querySelectorAll("[data-act]").forEach(btn => btn.addEventListener("click", () => {
      const a = btn.dataset.act;
      if (a === "group") mbGroupSelection();
      else if (a === "ungroup") mbUngroupSelection();
      else if (a === "front") mbReorder(true);
      else if (a === "back") mbReorder(false);
    }));
    p.querySelector(".mb-p-del").addEventListener("click", mbDeleteSelection);
    return;
  }

  // Einzelauswahl -> Eigenschaften + Ebene + Loeschen
  const el = curBoard().elements.find(x => x.id === mbSel[0]);
  if (!el) { p.style.display = "none"; p.innerHTML = ""; return; }
  // Text wird komplett ueber die schwebende Toolbar (beim Editieren) gesteuert -> kein Seiten-Panel.
  if (el.type === "text") { p.style.display = "none"; p.innerHTML = ""; return; }
  const title = el.type === "text" ? "Text" : el.type === "square" ? "Quadrat" : el.type === "image" ? "Bild" : el.type === "note" ? "Notiz" : "Rechteck";
  let html = `<div class="mb-p-title">${title}</div>`;
  if (el.type === "rect" || el.type === "square") {
    const noFill = !el.fill || el.fill === "transparent";
    html += mbField("Füllung", `<input type="color" data-k="fill" value="${noFill ? "#1e2a44" : el.fill}">`)
          + `<label class="mb-p-check"><input type="checkbox" data-k="fillNone" ${noFill ? "checked" : ""}> ohne Füllung</label>`
          + mbField("Rand", `<input type="color" data-k="stroke" value="${el.stroke || "#000000"}">`)
          + mbField("Randstärke", `<input type="number" min="0" max="20" data-k="strokeWidth" value="${el.strokeWidth || 0}">`);
    if (el.type === "rect")
      html += mbField("Eckenradius", `<input type="number" min="0" max="80" data-k="radius" value="${el.radius || 0}">`);
  } else if (el.type === "note") {
    html += mbField("Randfarbe", `<input type="color" data-k="stroke" value="${el.stroke || "#c9a24b"}">`)
          + mbField("Randstärke (gestrichelt)", `<input type="number" min="1" max="12" data-k="strokeWidth" value="${el.strokeWidth || 2}">`);
  }
  html += `<div class="mb-p-row"><span>Ebene</span><span class="mb-p-lay"><button class="tool" data-lay="front">Vorder</button><button class="tool" data-lay="back">Hinter</button></span></div>`;
  html += `<button class="danger mb-p-del">Element löschen</button>`;
  p.innerHTML = html;

  p.querySelectorAll("[data-k]").forEach(inp => {
    inp.addEventListener("input", () => {
      const k = inp.dataset.k;
      if (k === "fillNone") { el.fill = inp.checked ? "transparent" : "#1e2a44"; }
      else if (inp.type === "number") { el[k] = parseInt(inp.value) || 0; }
      else { el[k] = inp.value; }
      dirty = true;
      mbUpdateElementStyle(el);   // live, ohne Neu-Render (Fokus bleibt im Feld)
    });
  });
  p.querySelectorAll("[data-lay]").forEach(btn => btn.addEventListener("click", () => mbReorder(btn.dataset.lay === "front")));
  p.querySelector(".mb-p-del").addEventListener("click", mbDeleteSelection);
}
// Style eines Elements im DOM aktualisieren, ohne alles neu zu bauen.
function mbUpdateElementStyle(el) {
  const d = $(`.mb-el[data-id="${el.id}"]`); if (!d) return;
  if (el.type === "rect" || el.type === "square") {
    d.style.background = el.fill || "transparent";
    d.style.border = (el.strokeWidth || 0) + "px solid " + (el.stroke || "transparent");
    d.style.borderRadius = (el.radius || 0) + "px";
  } else if (el.type === "text") {
    d.style.color = el.color || "var(--ink)";
    d.style.fontSize = (el.fontSize || 16) + "px";
    d.style.fontFamily = el.fontFamily || "sans-serif";
    d.style.textAlign = el.align || "left";
  } else if (el.type === "note") {
    d.style.border = (el.strokeWidth || 2) + "px dashed " + (el.stroke || "#c9a24b");
  }
}

/* ---------- Notiz-Element (Etappe 6) ---------- */
let mbNoteOpenId = null, mbNoteOrig = null;
// Pin-Klick oeffnet die Notiz; Pin darf keinen Drag/keine Auswahl ausloesen.
function wireNotePin(elm, pin, id) {
  pin.addEventListener("pointerdown", e => { e.stopPropagation(); });
  pin.addEventListener("click", e => { e.stopPropagation(); mbOpenNote(id, elm); });
}
// Singleton-Popover am body (fixed positioniert, damit es nicht am Canvas-Rand abgeschnitten wird).
function mbNotePop() {
  let pop = document.getElementById("mbNotePop");
  if (pop) return pop;
  pop = document.createElement("div");
  pop.id = "mbNotePop"; pop.className = "mb-note-pop";
  pop.innerHTML = `<textarea class="mb-note-ta" readonly title="Klicken zum Bearbeiten"></textarea>`;
  document.body.appendChild(pop);
  pop.addEventListener("pointerdown", e => e.stopPropagation());   // Klick IN die Notiz schliesst nicht
  const ta = pop.querySelector(".mb-note-ta");
  // Ein Klick in die Notiz startet die Bearbeitung (kein Edit-Button mehr noetig).
  ta.addEventListener("click", () => { if (ta.readOnly) { ta.readOnly = false; ta.focus(); } });
  // Escape verwirft die Aenderungen und schliesst; Rausklicken speichert (mbCloseNote). Loeschen per ENTF.
  ta.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      e.preventDefault(); e.stopPropagation();
      ta.value = mbNoteOrig != null ? mbNoteOrig : "";
      mbCloseNote();
    }
  });
  return pop;
}
function mbSaveNote() {
  const pop = document.getElementById("mbNotePop");
  if (!pop || mbNoteOpenId == null) return;
  const el = curBoard().elements.find(x => x.id === mbNoteOpenId);
  if (el) { el.note = pop.querySelector(".mb-note-ta").value; dirty = true; }
}
function mbOpenNote(id, elm) {
  const el = curBoard().elements.find(x => x.id === id); if (!el || el.type !== "note") return;
  mbSaveNote();                                                    // evtl. offene Notiz sichern
  mbNoteOpenId = id;
  const pop = mbNotePop();
  const ta = pop.querySelector(".mb-note-ta");
  ta.value = (el.note != null && el.note !== "") ? el.note : "empty Note";
  ta.readOnly = true;
  mbNoteOrig = ta.value;                                           // Ausgangswert fuer Escape-Verwerfen
  pop.style.display = "flex";
  // Rechts vom Rahmen positionieren (Screen-Koords); bei Platzmangel nach links kippen.
  const r = elm.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = r.right + 10; if (left + pw > window.innerWidth - 8) left = r.left - pw - 10;
  left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
  let top = Math.max(8, Math.min(r.top, window.innerHeight - ph - 8));
  pop.style.left = left + "px"; pop.style.top = top + "px";
}
function mbCloseNote() {
  const pop = document.getElementById("mbNotePop");
  mbSaveNote();
  if (pop) pop.style.display = "none";
  mbNoteOpenId = null;
}

/* ---------- Kontextmenü (Rechtsklick) + interne Zwischenablage ---------- */
let svClip = null;                                            // interne Kopie (zuverlaessiger als Systemzwischenablage)
function mbCtxCopy() {
  if (!mbSel.length) return;
  svClip = mbCopyData();
  const payload = "SVCLIP:" + JSON.stringify(svClip);
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(payload).catch(() => {});
  setStatus(svClip.els.length + " kopiert.", "");
}
function mbCtxPaste() { if (svClip && svClip.kind === "mb") mbPasteData(svClip); }
// Notiz exakt um ein Objekt legen: gestrichelter Rahmen umschliesst das Objekt (kleiner Abstand).
function mbAddNoteAround(objId) {
  const b = curBoard();
  const obj = b.elements.find(x => x.id === objId); if (!obj) return;
  const pad = 6;
  const note = mbNewElement("note");
  note.x = Math.round(obj.x - pad); note.y = Math.round(obj.y - pad);
  note.w = Math.round(obj.w + pad * 2); note.h = Math.round(obj.h + pad * 2);
  note.note = "";
  b.elements.unshift(note);                                   // hinter das Objekt legen -> Objekt bleibt klickbar
  mbSel = [note.id]; dirty = true;
  setStatus("Notiz um das Objekt gelegt (nicht gespeichert).", "warn"); render();
}
function mbCtxMenuEl() {
  let m = document.getElementById("mbCtxMenu");
  if (m) return m;
  m = document.createElement("div"); m.id = "mbCtxMenu"; m.className = "mb-ctx";
  m.addEventListener("pointerdown", e => e.stopPropagation());   // Klick im Menue schliesst es nicht vorzeitig
  document.body.appendChild(m);
  return m;
}
function mbHideCtx() { const m = document.getElementById("mbCtxMenu"); if (m) m.style.display = "none"; }
function mbShowCtx(x, y, items) {
  const m = mbCtxMenuEl(); m.innerHTML = "";
  items.forEach(it => {
    if (it.sep) { const s = document.createElement("div"); s.className = "mb-ctx-sep"; m.appendChild(s); return; }
    const b = document.createElement("button");
    b.className = "mb-ctx-item"; b.textContent = it.label; b.disabled = !!it.disabled;
    if (!it.disabled) b.addEventListener("click", () => { mbHideCtx(); it.act(); });
    m.appendChild(b);
  });
  m.style.display = "block"; m.style.visibility = "hidden";     // erst messen, dann in den Sichtbereich ruecken
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let left = x, top = y;
  if (left + mw > window.innerWidth - 6) left = window.innerWidth - mw - 6;
  if (top + mh > window.innerHeight - 6) top = window.innerHeight - mh - 6;
  m.style.left = Math.max(6, left) + "px"; m.style.top = Math.max(6, top) + "px";
  m.style.visibility = "visible";
}
function mbOpenContextMenu(x, y) {
  const hasSel = mbSel.length > 0;
  const single = mbSel.length === 1 ? curBoard().elements.find(el => el.id === mbSel[0]) : null;
  const items = [
    { label: "Kopieren", disabled: !hasSel, act: mbCtxCopy },
    { label: "Einfügen", disabled: !svClip, act: mbCtxPaste },
    { sep: true },
    { label: "In den Vordergrund", disabled: !hasSel, act: () => mbReorder(true) },
    { label: "In den Hintergrund", disabled: !hasSel, act: () => mbReorder(false) },
    { label: "Nach vorne", disabled: !hasSel, act: () => mbReorderOne(true) },
    { label: "Nach hinten", disabled: !hasSel, act: () => mbReorderOne(false) },
  ];
  if (single && single.type !== "note")
    items.push({ sep: true }, { label: "Notiz hinzufügen", act: () => mbAddNoteAround(single.id) });
  mbShowCtx(x, y, items);
}

/* ---------- Bild-Zuschneiden (EINE Maske, ersetzend) ---------- */
// Es wird immer nur EINE Maske je Bild gespeichert (el.crop = das zuletzt Angewendete, als Ganzes).
// Das Bild selbst bleibt unveraendert; ausserhalb der Maske ist das Bild voll transparent (Alpha).
// Rueckgaengig geht nur ueber "Zuruecksetzen" (loescht die Maske komplett).
// Bild-Rendering mit Rahmen = Bounding-Box des Schnitts: das Bild ist groesser als der Rahmen
// (el.crop.fullW/H) und passend verschoben (el.crop.ox/oy). Der Rahmen (mb-el) clippt per overflow.
// Bei "circle" liegt der Kreis-Clip auf einem inneren Wrapper (nicht am Element) -> die rechteckige
// Auswahl-Umrandung bleibt sichtbar. So passt sich die Auswahlbox an den Ausschnitt an.
function mbBuildImageInner(el) {
  const img = document.createElement("img");
  img.className = "mb-img"; img.src = mbHostedImgUrls[el.src] || el.src || ""; img.alt = ""; img.draggable = false;
  if (el.crop) {
    img.style.position = "absolute";
    img.style.left = el.crop.ox + "px"; img.style.top = el.crop.oy + "px";
    img.style.width = el.crop.fullW + "px"; img.style.height = el.crop.fullH + "px";
    img.style.maxWidth = "none"; img.style.maxHeight = "none"; img.style.objectFit = "fill";
    if (el.crop.shape === "circle") {                // Kreis-Clip auf inneren Wrapper -> Element-Umrandung bleibt rechteckig
      const wrap = document.createElement("div");
      wrap.className = "mb-crop-wrap"; wrap.style.clipPath = "circle(closest-side)";
      wrap.appendChild(img); return wrap;
    }
  }
  return img;
}

// Crop-Zustand. Beim Editieren wird im VOLLBILD-Koordinatensystem (px) gearbeitet:
//   mbCropFull = Vollbildgroesse {W,H}; mbCropOff = Offset des Vollbilds relativ zum aktuellen Rahmen {x,y};
//   mbCropShape = aktive Maske in Vollbild-px ({kind:"rect",x,y,w,h} oder {kind:"circle",cx,cy,r}).
let mbCropId = null, mbCropElm = null, mbCropShape = null, mbCropDrag = null, mbCropFull = null, mbCropOff = null;

function mbCropToolbar() {
  let tb = document.getElementById("mbCropTb");
  if (tb) return tb;
  tb = document.createElement("div");
  tb.id = "mbCropTb"; tb.className = "mb-crop-tb";
  tb.innerHTML =
    `<label class="mb-crop-lbl">Maske` +
    `<select id="mbCropMode"><option value="rect">Individuell</option><option value="circle">Kreis</option></select></label>` +
    `<button id="mbCropReset" class="mb-crop-btn" title="Ganzes Bild wiederherstellen">↺ Zurücksetzen</button>` +
    `<span class="mb-crop-hint">Esc speichert</span>`;
  document.body.appendChild(tb);
  tb.addEventListener("pointerdown", e => e.stopPropagation());
  tb.querySelector("#mbCropMode").addEventListener("change", e => mbCropSwitchMode(e.target.value));
  tb.querySelector("#mbCropReset").addEventListener("click", mbCropReset);
  return tb;
}
function mbShowCropToolbar(elm) {
  const tb = mbCropToolbar(); tb.style.display = "flex";
  tb.querySelector("#mbCropMode").value = mbCropShape ? mbCropShape.kind : "rect";
  const r = elm.getBoundingClientRect(), w = tb.offsetWidth;
  tb.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + "px";
  let top = r.top - tb.offsetHeight - 8; if (top < 8) top = r.bottom + 8;
  tb.style.top = top + "px";
}
function mbHideCropToolbar() { const tb = document.getElementById("mbCropTb"); if (tb) tb.style.display = "none"; }

function mbEnterCrop(id, elm) {
  const el = curBoard().elements.find(x => x.id === id); if (!el || el.type !== "image") return;
  if (mbCropId != null && mbCropId !== id) mbExitCrop(true);
  mbCropId = id; mbCropElm = elm;
  // Vollbild-Basis + aktive Maske im Vollbild-px-System bestimmen (letzte Maske laden).
  if (el.crop) {
    mbCropFull = { W: el.crop.fullW, H: el.crop.fullH };
    mbCropOff = { x: el.crop.ox, y: el.crop.oy };
    const fx = -el.crop.ox, fy = -el.crop.oy;                  // Rahmen relativ zum Vollbild
    mbCropShape = el.crop.shape === "circle"
      ? { kind: "circle", cx: fx + el.w / 2, cy: fy + el.h / 2, r: Math.min(el.w, el.h) / 2 }
      : { kind: "rect", x: fx, y: fy, w: el.w, h: el.h };
  } else {
    mbCropFull = { W: el.w, H: el.h };
    mbCropOff = { x: 0, y: 0 };
    mbCropShape = { kind: "rect", x: 0, y: 0, w: el.w, h: el.h };
  }
  mbSetSelection([id]);
  elm.classList.add("cropping");
  mbCropBuildEditView();
  mbShowCropToolbar(elm);
  document.addEventListener("keydown", mbCropKey, true);
  setStatus("Zuschneiden — Griffe ziehen, Modus oben wählen, Esc speichert.", "");
}
// Editier-Ansicht: VOLLES Bild + Overlay am Offset/Groesse des Vollbilds (ueberlappt den Rahmen).
function mbCropBuildEditView() {
  const elm = mbCropElm; if (!elm) return;
  const el = curBoard().elements.find(x => x.id === mbCropId); if (!el) return;
  elm.querySelectorAll(".mb-img, .mb-crop-wrap, .mb-crop-ov").forEach(n => n.remove());
  elm.style.overflow = "visible"; elm.style.clipPath = "none";  // beim Editieren ganzes Bild zeigen
  const img = document.createElement("img");
  img.className = "mb-img"; img.src = mbHostedImgUrls[el.src] || el.src || ""; img.draggable = false;
  img.style.position = "absolute";
  img.style.left = mbCropOff.x + "px"; img.style.top = mbCropOff.y + "px";
  img.style.width = mbCropFull.W + "px"; img.style.height = mbCropFull.H + "px";
  img.style.maxWidth = "none"; img.style.maxHeight = "none"; img.style.objectFit = "fill";
  elm.insertBefore(img, elm.firstChild);
  const ov = document.createElement("div"); ov.className = "mb-crop-ov";
  ov.style.left = mbCropOff.x + "px"; ov.style.top = mbCropOff.y + "px";
  ov.style.width = mbCropFull.W + "px"; ov.style.height = mbCropFull.H + "px";
  ov.style.right = "auto"; ov.style.bottom = "auto";
  elm.appendChild(ov); mbCropWireOverlay(ov);
  mbCropRender();
}
// Screen-px pro Canvas-px (Zoom) am aktuellen Element.
function mbCropScale() {
  const el = curBoard().elements.find(x => x.id === mbCropId);
  const rect = mbCropElm.getBoundingClientRect();
  return el && el.w ? rect.width / el.w : 1;
}
function mbCropRender() {
  const ov = mbCropElm && mbCropElm.querySelector(".mb-crop-ov"); if (!ov || !mbCropShape) return;
  const W = mbCropFull.W, H = mbCropFull.H;
  let hole, outline, pts;
  if (mbCropShape.kind === "circle") {
    const { cx, cy, r } = mbCropShape;
    hole = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="black"/>`;
    outline = `<div class="mb-crop-outline circle" style="left:${cx - r}px;top:${cy - r}px;width:${r * 2}px;height:${r * 2}px"></div>`;
    pts = [["nw", cx - r, cy - r], ["n", cx, cy - r], ["ne", cx + r, cy - r], ["e", cx + r, cy],
           ["se", cx + r, cy + r], ["s", cx, cy + r], ["sw", cx - r, cy + r], ["w", cx - r, cy]];
  } else {
    const { x, y, w, h } = mbCropShape;
    hole = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="black"/>`;
    outline = `<div class="mb-crop-outline" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"></div>`;
    pts = [["nw", x, y], ["n", x + w / 2, y], ["ne", x + w, y], ["e", x + w, y + h / 2],
           ["se", x + w, y + h], ["s", x + w / 2, y + h], ["sw", x, y + h], ["w", x, y + h / 2]];
  }
  ov.innerHTML =
    `<svg class="mb-crop-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">` +
      `<defs><mask id="mbCropMask"><rect width="${W}" height="${H}" fill="white"/>${hole}</mask></defs>` +
      `<rect width="${W}" height="${H}" fill="rgba(15,17,22,.62)" mask="url(#mbCropMask)"/>` +
    `</svg>` + outline +
    pts.map(([hh, px, py]) => `<div class="mb-crop-h mb-crop-h-${hh}" data-h="${hh}" style="left:${px}px;top:${py}px"></div>`).join("");
}
function mbCropWireOverlay(ov) {
  ov.addEventListener("pointerdown", e => {
    e.stopPropagation(); e.preventDefault();
    const h = (e.target.classList && e.target.classList.contains("mb-crop-h")) ? e.target.dataset.h : null;
    mbCropDrag = { h, sx: e.clientX, sy: e.clientY, shape: JSON.parse(JSON.stringify(mbCropShape)), scale: mbCropScale(), rect: mbCropElm.getBoundingClientRect() };
    ov.setPointerCapture(e.pointerId);
  });
  ov.addEventListener("pointermove", e => {
    if (!mbCropDrag) return;
    const dx = (e.clientX - mbCropDrag.sx) / mbCropDrag.scale, dy = (e.clientY - mbCropDrag.sy) / mbCropDrag.scale;
    mbCropShape = mbCropDrag.shape.kind === "circle"
      ? mbCropDragCircle(mbCropDrag.shape, mbCropDrag.h, e, mbCropDrag, dx, dy)
      : mbCropDragRect(mbCropDrag.shape, mbCropDrag.h, dx, dy);
    mbCropRender();
  });
  ov.addEventListener("pointerup", e => { if (mbCropDrag) { try { ov.releasePointerCapture(e.pointerId); } catch {} mbCropDrag = null; } });
}
function mbCropDragRect(box, h, dx, dy) {
  const W = mbCropFull.W, H = mbCropFull.H, MIN = 20;
  let { x, y, w, h: hh } = box;
  if (!h) {                                                   // verschieben, im Vollbild halten
    x = Math.max(0, Math.min(W - w, x + dx));
    y = Math.max(0, Math.min(H - hh, y + dy));
  } else {
    if (h.includes("w")) { const nx = Math.max(0, Math.min(x + w - MIN, x + dx)); w += x - nx; x = nx; }
    if (h.includes("e")) { w = Math.max(MIN, Math.min(W - x, w + dx)); }
    if (h.includes("n")) { const ny = Math.max(0, Math.min(y + hh - MIN, y + dy)); hh += y - ny; y = ny; }
    if (h.includes("s")) { hh = Math.max(MIN, Math.min(H - y, hh + dy)); }
  }
  return { kind: "rect", x, y, w, h: hh };
}
function mbCropDragCircle(shape, h, e, drag, dx, dy) {
  const W = mbCropFull.W, H = mbCropFull.H, MIN = 12;
  let { cx, cy, r } = shape;
  if (!h) { cx = cx + dx; cy = cy + dy; }                     // verschieben
  else {                                                      // Radius aus Zeigerabstand zum Mittelpunkt (Vollbild-px)
    const px = (e.clientX - drag.rect.left) / drag.scale - mbCropOff.x;
    const py = (e.clientY - drag.rect.top) / drag.scale - mbCropOff.y;
    r = Math.max(Math.abs(px - cx), Math.abs(py - cy));
  }
  r = Math.max(MIN, Math.min(r, cx, W - cx, cy, H - cy));      // in das Vollbild einpassen
  cx = Math.min(W - r, Math.max(r, cx));
  cy = Math.min(H - r, Math.max(r, cy));
  return { kind: "circle", cx, cy, r };
}
// Werkzeugwechsel: Geometrie beibehalten (Rechteck<->Kreis), noch NICHT den Rahmen aendern (das passiert beim Verlassen).
function mbCropSwitchMode(mode) {
  if (!mbCropShape || mode === mbCropShape.kind) return;
  if (mode === "circle") {                                    // aus Rechteck -> mittiger Kreis (90% der kuerzeren Seite)
    const { x, y, w, h } = mbCropShape;
    mbCropShape = { kind: "circle", cx: x + w / 2, cy: y + h / 2, r: 0.9 * Math.min(w, h) / 2 };
  } else {                                                    // aus Kreis -> dessen Bounding-Box
    const { cx, cy, r } = mbCropShape;
    mbCropShape = { kind: "rect", x: cx - r, y: cy - r, w: 2 * r, h: 2 * r };
  }
  const tb = document.getElementById("mbCropTb"); if (tb) tb.querySelector("#mbCropMode").value = mode;
  mbCropRender();
}
// Maske anwenden: Rahmen (el.x/y/w/h) = Bounding-Box der Maske; Bild groesser dahinter (ox/oy/fullW/H).
function mbCropApply() {
  const el = curBoard().elements.find(x => x.id === mbCropId); if (!el || !mbCropShape) return;
  const W = mbCropFull.W, H = mbCropFull.H, s = mbCropShape;
  let bx, by, bw, bh, shape;
  if (s.kind === "circle") { bx = s.cx - s.r; by = s.cy - s.r; bw = s.r * 2; bh = s.r * 2; shape = "circle"; }
  else { bx = s.x; by = s.y; bw = s.w; bh = s.h; shape = "rect"; }
  const fullX = el.x + mbCropOff.x, fullY = el.y + mbCropOff.y;   // Vollbild-Ecke in Canvas-Koordinaten
  const isFull = shape === "rect" && bx <= 0.5 && by <= 0.5 && bw >= W - 0.5 && bh >= H - 0.5;
  if (isFull) {                                                  // kein Zuschnitt -> ganzes Bild als Rahmen
    el.x = Math.round(fullX); el.y = Math.round(fullY); el.w = Math.round(W); el.h = Math.round(H); el.crop = null;
  } else {
    el.x = Math.round(fullX + bx); el.y = Math.round(fullY + by); el.w = Math.round(bw); el.h = Math.round(bh);
    el.crop = { fullW: Math.round(W), fullH: Math.round(H), ox: Math.round(-bx), oy: Math.round(-by), shape };
  }
  dirty = true;
}
// Zuruecksetzen: Maske auf ganzes Bild -> beim Verlassen wird el.crop geloescht und der Rahmen aufs Vollbild gesetzt.
function mbCropReset() {
  if (!mbCropFull) return;
  mbCropShape = { kind: "rect", x: 0, y: 0, w: mbCropFull.W, h: mbCropFull.H };
  const tb = document.getElementById("mbCropTb"); if (tb) tb.querySelector("#mbCropMode").value = "rect";
  mbCropRender(); setStatus("Ganzes Bild wiederhergestellt (beim Verlassen übernommen).", "");
}
function mbCropKey(e) {
  if (mbCropId == null) return;
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); mbExitCrop(true); }
}
function mbExitCrop(save) {
  if (mbCropId == null) return;
  if (save) mbCropApply();
  const elm = mbCropElm;
  mbCropId = null; mbCropElm = null; mbCropShape = null; mbCropDrag = null; mbCropFull = null; mbCropOff = null;
  document.removeEventListener("keydown", mbCropKey, true);
  mbHideCropToolbar();
  if (elm) { elm.classList.remove("cropping"); elm.style.overflow = ""; elm.style.clipPath = ""; }
  if (save) setStatus("Ausschnitt übernommen (noch nicht in Datei gespeichert).", "warn");
  render(); histTouch();
}
/* ---------- Board-Liste (Sidebar-Unterpunkte) ---------- */
function renderMbSubnav(view) {
  const host = $("#mbSubnav"); if (!host) return;
  const expanded = mbExpanded && view === "moodboard";
  host.style.display = expanded ? "" : "none";
  if (!expanded) { host.innerHTML = ""; return; }

  const m = mbData();
  const boards = m.boards, folders = m.folders;

  const boardRow = b => `
    <div class="arch-sub ${b.id === activeBoardId ? "active" : ""}" draggable="true" data-id="${b.id}" data-folder="${b.folderId || ""}">
      <span class="dot"></span><span class="nm">${escapeHtml(b.name || "(ohne Name)")}</span>
      <span class="sub-del" data-del="${b.id}" title="Board löschen">✕</span>
    </div>`;

  let foldersHtml = "";
  folders.forEach(f => {
    const kids = boards.filter(b => b.folderId === f.id);
    foldersHtml += `
      <div class="mb-folder ${f.collapsed ? "collapsed" : ""}" draggable="true" data-folder-id="${f.id}">
        <span class="fold-tw">${f.collapsed ? "▸" : "▾"}</span>
        <span class="fold-ico">📁</span>
        <span class="nm">${escapeHtml(f.name || "(Ordner)")}</span>
        <span class="fold-count">${kids.length}</span>
        <span class="sub-del" data-delfolder="${f.id}" title="Ordner löschen">✕</span>
      </div>`;
    if (!f.collapsed) foldersHtml += kids.map(boardRow).join("");
  });
  const looseHtml = boards.filter(b => !b.folderId).map(boardRow).join("");

  let html;
  if (!folders.length && !boards.length)
    html = '<div class="arch-sub-empty">Noch keine Boards.<br>Oben ein Element setzt das erste an.</div>';
  else
    // Ordner-Bereich oben, danach ein Trenner, dann die losen Boards.
    html = foldersHtml + (foldersHtml && looseHtml ? '<div class="mb-sub-sep"></div>' : "") + looseHtml;

  host.innerHTML = html;

  host.querySelectorAll(".arch-sub").forEach(el => {
    el.addEventListener("click", e => {
      if (e.target.closest(".sub-del")) { mbDeleteBoard(el.dataset.id); return; }
      activeBoardId = el.dataset.id; mbSel = []; render();
    });
  });
  host.querySelectorAll(".mb-folder").forEach(el => {
    el.addEventListener("click", e => {
      if (e.target.closest("[data-delfolder]")) { mbDeleteFolder(el.dataset.folderId); return; }
      mbToggleFolder(el.dataset.folderId);          // ganze Kopfzeile klappt auf/zu
    });
  });
  wireMbSubnavDnD(host);
}

/* ---------- Ordner (nicht verschachtelbar) ---------- */
function mbAddFolder() {
  const name = prompt("Name des neuen Ordners:", "Neuer Ordner");
  if (name == null) return;                         // im Dialog abgebrochen
  mbData().folders.push({ id: "f-" + Date.now().toString(36), name: name.trim() || "Ordner", collapsed: false });
  dirty = true; setStatus("Ordner angelegt (nicht gespeichert).", "warn");
  mbExpanded = true; renderMbSubnav(currentView());
}
function mbToggleFolder(id) {
  const f = mbData().folders.find(x => x.id === id); if (!f) return;
  f.collapsed = !f.collapsed;                        // bewusst ohne dirty: reiner Ansichtszustand
  renderMbSubnav(currentView());
}
function mbDeleteFolder(id) {
  const m = mbData();
  const f = m.folders.find(x => x.id === id); if (!f) return;
  const kids = m.boards.filter(b => b.folderId === id);
  const msg = kids.length
    ? `Ordner „${f.name}“ und die ${kids.length} Board(s) darin löschen?`
    : `Ordner „${f.name}“ löschen?`;
  if (!confirm(msg)) return;
  kids.forEach(b => { delete mbViewByBoard[b.id]; if (activeBoardId === b.id) { activeBoardId = null; mbSel = []; } });
  m.boards = m.boards.filter(b => b.folderId !== id);
  m.folders = m.folders.filter(x => x.id !== id);
  dirty = true; setStatus("Ordner gelöscht (nicht gespeichert).", "warn"); render();
}

/* ---------- Sidebar-DnD: Boards & Ordner sortieren, mit Einfüge-Linie ---------- */
function wireMbSubnavDnD(host) {
  host.querySelectorAll(".arch-sub[data-id]").forEach(el => {
    el.addEventListener("dragstart", e => { mbSubDrag = { type: "board", id: el.dataset.id, folderId: el.dataset.folder || null }; el.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
    el.addEventListener("dragend", () => { el.classList.remove("dragging"); mbSubDrag = null; mbSubDropMode = null; clearMbSubLine(); });
  });
  host.querySelectorAll(".mb-folder").forEach(el => {
    el.addEventListener("dragstart", e => { mbSubDrag = { type: "folder", id: el.dataset.folderId }; el.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
    el.addEventListener("dragend", () => { el.classList.remove("dragging"); mbSubDrag = null; mbSubDropMode = null; clearMbSubLine(); });
  });

  // Container-Listener nur EINMAL binden — #mbSubnav bleibt ueber Renders bestehen,
  // sonst stapelt sich pro Render ein weiterer dragover-Handler (Lag).
  if (host.dataset.dndWired === "1") return;
  host.dataset.dndWired = "1";

  host.addEventListener("dragover", e => {
    if (!mbSubDrag) return;
    e.preventDefault();
    host.querySelectorAll(".mb-folder.icon-drop").forEach(el => el.classList.remove("icon-drop"));
    if (mbSubDrag.type === "folder") { mbSubDropMode = { kind: "folder" }; showMbSubLine(host, mbSubFolderBefore(host, e.clientY)); return; }
    // Direkt auf dem Ordner-Icon? -> in den Ordner ablegen (der einzige Weg IN einen Ordner)
    const iconFolder = mbSubIconHit(host, e.clientX, e.clientY);
    if (iconFolder) {
      clearMbSubLine();
      iconFolder.classList.add("icon-drop");                       // Icon vergroessern + faerben
      mbSubDropMode = { kind: "icon", folderId: iconFolder.dataset.folderId };
      return;
    }
    // Sonst: normale Sortier-Linie (aendert die Zugehoerigkeit NICHT in einen fremden Ordner)
    const t = mbSubLineTarget(host, e.clientY);
    mbSubDropMode = { kind: "line", folderId: t.folderId, beforeId: t.beforeId };
    showMbSubLine(host, t.before);
  });
  host.addEventListener("dragleave", e => { if (!host.contains(e.relatedTarget)) clearMbSubLine(); });
  host.addEventListener("drop", e => {
    if (!mbSubDrag) return;
    e.preventDefault();
    const m = mbSubDropMode;
    if (mbSubDrag.type === "folder") mbSubFolderDrop(host, e.clientY);
    else if (m && m.kind === "icon") mbSubBoardIntoFolder(m.folderId);
    else if (m && m.kind === "line") mbSubBoardApplyLine(m.folderId, m.beforeId);
    clearMbSubLine(); mbSubDrag = null; mbSubDropMode = null;
  });
}
// Liegt der Cursor (mit etwas Toleranz) ueber einem Ordner-Icon? -> zugehoerige Ordner-Kopfzeile.
function mbSubIconHit(host, x, y) {
  const pad = 7;
  for (const ico of host.querySelectorAll(".mb-folder .fold-ico")) {
    const r = ico.getBoundingClientRect();
    if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) return ico.closest(".mb-folder");
  }
  return null;
}
// Sortier-Linie: nur im eigenen Ordner des Boards oder im Lose-Bereich; nie IN einen fremden Ordner.
function mbSubLineTarget(host, y) {
  const cf = mbSubDrag.folderId || null;               // aktueller Ordner des gezogenen Boards
  const rows = [...host.querySelectorAll(".mb-folder:not(.dragging), .arch-sub[data-id]:not(.dragging)")];
  let above = null, beforeRow = null;
  for (const el of rows) {
    const r = el.getBoundingClientRect();
    if (y < r.top + r.height / 2) { beforeRow = el; break; }
    above = el;
  }
  let folderId = null;
  if (above) folderId = above.classList.contains("mb-folder") ? above.dataset.folderId : (above.dataset.folder || null);
  if (!beforeRow) folderId = null;                     // ganz unten -> Top-Level
  // Guard: per Linie NICHT in einen fremden Ordner. In den Lose-Bereich klemmen.
  if (folderId && folderId !== cf) {
    folderId = null;
    beforeRow = host.querySelector('.arch-sub[data-id][data-folder=""]:not(.dragging)') || null;
  }
  let beforeId = null;
  if (beforeRow && !beforeRow.classList.contains("mb-folder") && (beforeRow.dataset.folder || null) === folderId)
    beforeId = beforeRow.dataset.id;
  return { folderId, beforeId, before: beforeRow };
}
function mbSubBoardIntoFolder(folderId) {
  const arr = mbData().boards;
  const drag = arr.find(b => b.id === mbSubDrag.id); if (!drag) return;
  arr.splice(arr.indexOf(drag), 1);
  drag.folderId = folderId;
  let last = -1; arr.forEach((b, i) => { if (b.folderId === folderId) last = i; });   // ans Ende des Ordners
  arr.splice(last >= 0 ? last + 1 : arr.length, 0, drag);
  const f = mbData().folders.find(x => x.id === folderId); if (f) f.collapsed = false; // aufklappen, damit man's landen sieht
  dirty = true; setStatus("Board in Ordner verschoben (nicht gespeichert).", "warn"); render();
}
function mbSubBoardApplyLine(folderId, beforeId) {
  const arr = mbData().boards;
  const drag = arr.find(b => b.id === mbSubDrag.id); if (!drag) return;
  arr.splice(arr.indexOf(drag), 1);
  if (folderId) drag.folderId = folderId; else delete drag.folderId;
  let at;
  if (beforeId) { at = arr.findIndex(b => b.id === beforeId); if (at < 0) at = arr.length; }
  else { let last = -1; arr.forEach((b, i) => { if ((b.folderId || null) === (folderId || null)) last = i; }); at = last >= 0 ? last + 1 : arr.length; }
  arr.splice(at, 0, drag);
  dirty = true; setStatus("Boards neu sortiert (nicht gespeichert).", "warn"); render();
}
// Ordner untereinander sortieren.
function mbSubFolderBefore(host, y) {
  const heads = [...host.querySelectorAll(".mb-folder:not(.dragging)")];
  for (const el of heads) { const r = el.getBoundingClientRect(); if (y < r.top + r.height / 2) return el; }
  return null;
}
function mbSubFolderDrop(host, y) {
  const folders = mbData().folders;
  const drag = folders.find(f => f.id === mbSubDrag.id); if (!drag) return;
  const beforeEl = mbSubFolderBefore(host, y);
  const beforeId = beforeEl ? beforeEl.dataset.folderId : null;
  folders.splice(folders.indexOf(drag), 1);
  const at = beforeId ? folders.findIndex(f => f.id === beforeId) : -1;
  folders.splice(at < 0 ? folders.length : at, 0, drag);
  dirty = true; setStatus("Ordner neu sortiert (nicht gespeichert).", "warn"); render();
}
function showMbSubLine(host, beforeEl) {
  clearMbSubLine();
  const line = document.createElement("div"); line.className = "drop-line mb-sub-line"; line.id = "__mbSubLine";
  if (beforeEl) host.insertBefore(line, beforeEl); else host.appendChild(line);
}
function clearMbSubLine() {
  const l = document.getElementById("__mbSubLine"); if (l) l.remove();
  document.querySelectorAll(".mb-folder.icon-drop").forEach(el => el.classList.remove("icon-drop"));
}

function mbDeleteBoard(id) {
  const m = mbData();
  const b = m.boards.find(x => x.id === id);
  if (!confirm("Board „" + (b ? b.name : "") + "“ mit allen Elementen löschen?")) return;
  m.boards = m.boards.filter(x => x.id !== id);
  delete mbViewByBoard[id];
  if (activeBoardId === id) { activeBoardId = null; mbSel = []; }
  dirty = true; setStatus("Board gelöscht (nicht gespeichert).", "warn"); render();
}

/* ---------- Zoom-Buttons ---------- */
function mbZoomBy(f) {
  const c = $("#mbCanvas"); if (!c) return;
  const r = c.getBoundingClientRect();
  const mx = r.width / 2, my = r.height / 2, v = mbCurView();
  const ns = archClamp(v.s * f, MB_ZMIN, 2.5);
  v.tx = mx - (mx - v.tx) * (ns / v.s);
  v.ty = my - (my - v.ty) * (ns / v.s);
  v.s = ns; mbClampView(v); mbApplyView();
}
function mbZoomReset() { const v = mbCurView(); v.tx = 0; v.ty = 0; v.s = 1; mbApplyView(); }

/* ---------- Bild-Einfuegen (Etappe 4c) ---------- */
// Speichert Bilder als Dateien in docs/images/ (relativer Pfad in der JSON).
// Schreiben braucht ein Verzeichnis-Handle (File System Access, nur Chromium).
let mbDirHandle = null;
let mbHostedImgUrls = {};                                   // gehostet: images/-Pfad -> Objekt-URL (Sofort-Anzeige bis zum Deploy)

// Winziger IndexedDB-KV-Store, damit der Ordner-Zugriff Sessions ueberdauert.
function mbIdb() {
  return new Promise(res => {
    const req = indexedDB.open("sv-moodboard", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => res(req.result);
    req.onerror = () => res(null);
  });
}
async function mbSaveHandle(h) { const db = await mbIdb(); if (db) db.transaction("kv", "readwrite").objectStore("kv").put(h, "docsDir"); }
async function mbLoadHandle() {
  const db = await mbIdb(); if (!db) return null;
  return new Promise(res => { const r = db.transaction("kv").objectStore("kv").get("docsDir"); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); });
}
// Zustand + Datei-Handle im selben KV-Store ablegen: ueberdauert Reloads, damit die Roadmap
// ohne Datei-Dialog zurueckkommt (und ungespeicherte Aenderungen erhalten bleiben).
let svCacheTimer = null;
const SV_STATE_KEY = "sv_roadmapState";
function svWriteState(str) {                                // synchron -> ueberlebt den Reload zuverlaessig (localStorage)
  try { localStorage.setItem(SV_STATE_KEY, str); } catch (_) {}
}
function svCacheState(str) {                                // mit fertigem String -> sofort; ohne -> entprellt
  if (str) { svWriteState(str); return; }
  if (!state) return;
  clearTimeout(svCacheTimer);
  svCacheTimer = setTimeout(() => { if (state) svWriteState(JSON.stringify(state)); }, 400);
}
function svLoadState() {
  try { const s = localStorage.getItem(SV_STATE_KEY); return s ? JSON.parse(s) : null; } catch (_) { return null; }
}
async function svSaveFileHandle(h) { try { const db = await mbIdb(); if (db) db.transaction("kv", "readwrite").objectStore("kv").put(h, "roadmapFile"); } catch (_) {} }
async function svLoadFileHandle() {
  try {
    const db = await mbIdb(); if (!db) return null;
    return await new Promise(res => { const r = db.transaction("kv").objectStore("kv").get("roadmapFile"); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); });
  } catch (_) { return null; }
}
async function mbVerifyPerm(h) {
  try {
    const o = { mode: "readwrite" };
    if ((await h.queryPermission(o)) === "granted") return true;
    return (await h.requestPermission(o)) === "granted";   // braucht Nutzergeste (Paste ist eine)
  } catch { return false; }
}
// Liefert das docs/-Verzeichnis-Handle (gemerkt) oder fragt einmalig nach.
async function mbEnsureDir() {
  if (mbDirHandle && await mbVerifyPerm(mbDirHandle)) return mbDirHandle;
  if (!window.showDirectoryPicker) { setStatus("Browser unterstützt keinen Ordnerzugriff (nur Chromium).", "warn"); return null; }
  try {
    const h = await window.showDirectoryPicker({ id: "sv-docs", mode: "readwrite" });
    mbDirHandle = h; mbSaveHandle(h); return h;
  } catch { return null; }   // Nutzer hat abgebrochen
}
// Bild auf maxDim herunterskalieren, als PNG-Blob + Zielmasse zurueckgeben.
function mbDownscale(blob, maxDim) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight;
      const s = Math.min(1, maxDim / Math.max(w, h));
      w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(img, 0, 0, w, h);
      cv.toBlob(b => { URL.revokeObjectURL(img.src); b ? res({ blob: b, w, h }) : rej(new Error("toBlob fehlgeschlagen")); }, "image/png");
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); rej(new Error("Bild konnte nicht geladen werden")); };
    img.src = URL.createObjectURL(blob);
  });
}
// Ein eingefuegtes Bild verarbeiten: Ordner sichern, Datei schreiben, Element anlegen.
async function mbInsertImage(blob, pos) {
  setStatus("Bild wird gespeichert…", "");
  if (IS_HOSTED) { return mbInsertImageHosted(blob, pos); } // gehostet: Upload via /api/image statt Ordner-Handle
  const dir = await mbEnsureDir();                          // ggf. Ordner-Auswahl (Paste-Geste)
  if (!dir) { setStatus("Kein Ordnerzugriff — Bild nicht gespeichert.", "warn"); return; }
  let out;
  try { out = await mbDownscale(blob, 1200); } catch (e) { setStatus("Bild-Fehler: " + e.message, "warn"); return; }
  try {
    const imagesDir = await dir.getDirectoryHandle("images", { create: true });
    const name = "mb-" + Date.now().toString(36) + ".png";
    const fh = await imagesDir.getFileHandle(name, { create: true });
    const wr = await fh.createWritable(); await wr.write(out.blob); await wr.close();

    const b = ensureBoard();
    const el = mbNewElement("image");
    const maxBox = 320, sc = Math.min(1, maxBox / Math.max(out.w, out.h));   // Anzeigegroesse begrenzen
    el.src = "images/" + name; el.w = Math.round(out.w * sc); el.h = Math.round(out.h * sc);
    const canvas = $("#mbCanvas");
    const c = pos                                          // Drop-Punkt, sonst Mitte der Sicht
      ? mbToWorld(pos.x, pos.y)
      : (canvas ? (r => mbToWorld(r.left + r.width / 2, r.top + r.height / 2))(canvas.getBoundingClientRect()) : { x: 0, y: 0 });
    el.x = Math.round(c.x - el.w / 2); el.y = Math.round(c.y - el.h / 2);
    b.elements.push(el);
    mbSel = [el.id];
    dirty = true; setStatus("Bild eingefügt als " + el.src + " (nicht gespeichert).", "warn");
    render();
    histTouch();                                           // Bild-Insert in die Undo-History
  } catch (e) {
    setStatus("Bild-Datei-Fehler: " + (e && e.message ? e.message : e), "warn");
  }
}

// Gehosteter Einfuege-Pfad: Bild via /api/image ins Repo committen (statt Ordner-Handle).
// Anzeige laeuft sofort ueber eine lokale Objekt-URL; el.src bleibt der normale images/-Pfad,
// der nach dem naechsten roadmap-Save + Deploy auf allen Geraeten funktioniert.
async function mbInsertImageHosted(blob, pos) {
  let out;
  try { out = await mbDownscale(blob, 1200); } catch (e) { setStatus("Bild-Fehler: " + e.message, "warn"); return; }
  const name = "mb-" + Date.now().toString(36) + ".png";
  try {
    setStatus("Bild wird hochgeladen…", "");
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1]);   // data:-Prefix abschneiden
      r.onerror = () => rej(new Error("Bild konnte nicht gelesen werden"));
      r.readAsDataURL(out.blob);
    });
    const res = await fetch("/api/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, data: b64 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || ("HTTP " + res.status));
  } catch (e) {
    setStatus("Bild-Upload fehlgeschlagen: " + e.message, "warn");
    return;                                                // kein Element ohne Datei im Repo
  }

  const b = ensureBoard();
  const el = mbNewElement("image");
  const maxBox = 320, sc = Math.min(1, maxBox / Math.max(out.w, out.h));   // Anzeigegroesse begrenzen
  el.src = "images/" + name; el.w = Math.round(out.w * sc); el.h = Math.round(out.h * sc);
  const canvas = $("#mbCanvas");
  const c = pos                                            // Drop-Punkt, sonst Mitte der Sicht
    ? mbToWorld(pos.x, pos.y)
    : (canvas ? (r => mbToWorld(r.left + r.width / 2, r.top + r.height / 2))(canvas.getBoundingClientRect()) : { x: 0, y: 0 });
  el.x = Math.round(c.x - el.w / 2); el.y = Math.round(c.y - el.h / 2);
  b.elements.push(el);
  mbHostedImgUrls[el.src] = URL.createObjectURL(out.blob); // Sofort-Anzeige bis zum naechsten Deploy
  mbSel = [el.id];
  dirty = true; setStatus("Bild hochgeladen als " + el.src + " — „Speichern“ macht es fuer alle sichtbar.", "warn");
  render();
  histTouch();                                             // Bild-Insert in die Undo-History
}


/* ---------- Nav wiring ---------- */

/* ---------- Sync: 3-Wege-Merge (Basis, Objekt-Diff, Auto-Merge) ---------- */
// Sync-Schritt 3a: Aenderungen von zwei Leuten still zusammenfuehren, solange sie
// nicht DASSELBE Objekt betreffen. Objekte = alles mit id (Karten, Changelog, Docs,
// Phasen, Spalten, Boards/Elemente/Verbindungen/Ordner, Diagramme/Nodes/Edges).
// Drei Staende: Basis (Repo-Stand, auf dem meine Arbeit aufsetzt, im localStorage),
// Meins (state), Fremd (frisch geholter Repo-Stand). Konflikt am selben Objekt ->
// Merge bricht ab, es gilt das bisherige Verhalten (Dialog/409-Meldung).

const SV_BASE_KEY = "sv_baseState";

function svSaveBase(str) { try { localStorage.setItem(SV_BASE_KEY, str); } catch (_) {} }
function svLoadBase()    { try { const s = localStorage.getItem(SV_BASE_KEY); return s ? JSON.parse(s) : null; } catch (_) { return null; } }

// Stabiler Vergleichs-String: Schluessel rekursiv sortiert, damit reine
// Schluessel-Reihenfolge nie als "geaendert" zaehlt.
function svStableStr(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(svStableStr).join(",") + "]";
  return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + svStableStr(v[k])).join(",") + "}";
}

// Eine id-Liste (z.B. cards) dreiseitig mergen. Ergebnis-Reihenfolge: Fremd gibt das
// Geruest vor (ist committet), eigene Neuzugaenge kommen ans Ende (Changelog: nach vorn).
// Reihenfolge-Aenderungen an sich gelten bewusst NICHT als Konflikt (stumpf geloest).
function svMergeList(baseArr, mineArr, theirsArr, label, out) {
  const B = new Map((baseArr   || []).map(o => [o.id, o]));
  const M = new Map((mineArr   || []).map(o => [o.id, o]));
  const T = new Map((theirsArr || []).map(o => [o.id, o]));
  const result = [];
  const name = o => (o && (o.title || o.name || o.label)) || "";

  for (const [id, t] of T) {                             // Fremd-Geruest durchgehen
    const b = B.get(id), m = M.get(id);
    const tS = svStableStr(t), bS = b ? svStableStr(b) : null, mS = m ? svStableStr(m) : null;
    if (!b) {                                            // bei Fremd neu (oder von beiden neu angelegt)
      if (!m || mS === tS) { result.push(t); if (!m) out.fromTheirs++; }
      else out.conflicts.push(label + ": " + (name(t) || id) + " (beidseitig neu, unterschiedlich)");
      continue;
    }
    if (!m) {                                            // ich habe geloescht
      if (tS === bS) { out.fromMine++; continue; }       // Fremd unveraendert -> Loeschung gilt
      out.conflicts.push(label + ": " + (name(t) || id) + " (von mir geloescht, von anderen geaendert)");
      continue;
    }
    if (mS === tS) { result.push(m); continue; }         // identisch (oder beide gleich geaendert)
    if (mS === bS) { result.push(t); out.fromTheirs++; continue; }   // nur Fremd geaendert
    if (tS === bS) { result.push(m); out.fromMine++;  continue; }    // nur ich geaendert
    out.conflicts.push(label + ": " + (name(m) || id) + " (beidseitig geaendert)");
  }
  for (const [id, b] of B) {                             // von Fremd geloeschte Objekte
    if (T.has(id)) continue;
    const m = M.get(id);
    if (!m) continue;                                    // ich auch geloescht -> einig
    if (svStableStr(m) === svStableStr(b)) { out.fromTheirs++; continue; }  // ich unveraendert -> Loeschung gilt
    out.conflicts.push(label + ": " + (name(m) || id) + " (von anderen geloescht, von mir geaendert)");
  }
  for (const [id, m] of M) {                             // meine Neuzugaenge
    if (B.has(id) || T.has(id)) continue;
    if (label === "Changelog") result.unshift(m); else result.push(m);
    out.fromMine++;
  }
  return result;
}

// Container mit benannten id-Listen (Act, Board, Diagramm, moodboard, architecture)
// pro Liste mergen; skalare Felder (name, tagline, note, ...) dreiseitig entscheiden.
function svMergeContainer(base, mine, theirs, listKeys, label, out) {
  const res = {};
  const keys = new Set([...Object.keys(theirs || {}), ...Object.keys(mine || {}), ...Object.keys(base || {})]);
  for (const k of keys) {
    const b = base ? base[k] : undefined, m = mine ? mine[k] : undefined, t = theirs ? theirs[k] : undefined;
    if (listKeys[k]) {                                   // id-Liste -> Listen-Merge (ggf. rekursiv)
      res[k] = listKeys[k](b, m, t, out);
      continue;
    }
    const bS = svStableStr(b), mS = svStableStr(m), tS = svStableStr(t);
    if (mS === tS) { if (m !== undefined) res[k] = m; continue; }
    if (mS === bS) { if (t !== undefined) res[k] = t; else continue; out.fromTheirs++; continue; }
    if (tS === bS) { if (m !== undefined) res[k] = m; else continue; out.fromMine++;  continue; }
    out.conflicts.push(label + ": Feld \u201E" + k + "\u201C (beidseitig geaendert)");
    res[k] = m;                                          // Platzhalter; bei Konflikt wird eh abgebrochen
  }
  return res;
}

// Ein Act komplett mergen: alle Kategorien sind id-Listen, Boards/Diagramme rekursiv.
function svMergeAct(b, m, t, out) {
  const actLabel = (t && t.name) || (m && m.name) || "Act";
  return svMergeContainer(b, m, t, {
    phases:    (bb, mm, tt) => svMergeList(bb, mm, tt, actLabel + "/Phasen",    out),
    columns:   (bb, mm, tt) => svMergeList(bb, mm, tt, actLabel + "/Spalten",   out),
    cards:     (bb, mm, tt) => svMergeList(bb, mm, tt, actLabel + "/Karten",    out),
    changelog: (bb, mm, tt) => svMergeList(bb, mm, tt, "Changelog",             out),
    docs:      (bb, mm, tt) => svMergeList(bb, mm, tt, actLabel + "/Doku",      out),
    architecture: (bb, mm, tt) => svMergeContainer(bb, mm, tt, {
      diagrams: (b2, m2, t2) => svMergeDeepList(b2, m2, t2, actLabel + "/Diagramm", ["nodes", "edges"], out),
    }, actLabel + "/Architektur", out),
    moodboard: (bb, mm, tt) => svMergeContainer(bb, mm, tt, {
      boards:  (b2, m2, t2) => svMergeDeepList(b2, m2, t2, actLabel + "/Board", ["elements", "connections"], out),
      folders: (b2, m2, t2) => svMergeList(b2, m2, t2, actLabel + "/Ordner", out),
    }, actLabel + "/Moodboard", out),
  }, actLabel, out);
}

// id-Liste, deren Objekte selbst id-Listen enthalten (Boards mit elements/connections,
// Diagramme mit nodes/edges): Container-Objekte per id matchen, innen weiter mergen.
function svMergeDeepList(baseArr, mineArr, theirsArr, label, innerKeys, out) {
  const B = new Map((baseArr   || []).map(o => [o.id, o]));
  const M = new Map((mineArr   || []).map(o => [o.id, o]));
  const T = new Map((theirsArr || []).map(o => [o.id, o]));
  // Praesenz (angelegt/geloescht/umbenannt) regelt der flache Listen-Merge auf
  // "Huellen" ohne Innenleben; das Innenleben wird danach pro Container gemergt.
  const strip = o => { const c = { ...o }; for (const k of innerKeys) delete c[k]; return c; };
  const shell = svMergeList((baseArr||[]).map(strip), (mineArr||[]).map(strip), (theirsArr||[]).map(strip), label, out);
  return shell.map(sh => {
    const b = B.get(sh.id), m = M.get(sh.id), t = T.get(sh.id);
    const inner = {};
    for (const k of innerKeys) {
      inner[k] = svMergeList(b && b[k], m && m[k], t && t[k], label + " \u201E" + (sh.name || sh.id) + "\u201C", out);
    }
    return { ...sh, ...inner };
  });
}

// Einstiegspunkt: kompletter 3-Wege-Merge. Liefert { ok, state, conflicts, fromMine, fromTheirs }.
// ok=false bei Konflikten ODER fehlender Basis (dann gilt das bisherige Verhalten).
function svMerge3(base, mine, theirs) {
  const out = { conflicts: [], fromMine: 0, fromTheirs: 0 };
  if (!base || !base.acts || !mine || !theirs) return { ok: false, noBase: true, ...out };
  try {
    const merged = svMergeContainer(base, mine, theirs, {
      acts: (bb, mm, tt) => svMergeDeepListActs(bb, mm, tt, out),
    }, "Projekt", out);
    // meta gesondert: Revision/updated kommen von Fremd (neuer Basisstand);
    // uebrige meta-Felder hat der Container-Merge oben schon entschieden.
    merged.meta = merged.meta || {};
    merged.meta.revision = (theirs.meta && theirs.meta.revision) || 0;
    merged.meta.updated  = (theirs.meta && theirs.meta.updated) || merged.meta.updated;
    delete merged.meta.activeAct; delete merged.meta.activeView;   // UI-Zustand bleibt draussen
    if (out.conflicts.length) return { ok: false, ...out };
    return { ok: true, state: merged, ...out };
  } catch (e) {
    out.conflicts.push("Merge-Fehler: " + e.message);     // defensiv: lieber Rueckfall als kaputter Stand
    return { ok: false, ...out };
  }
}

// Acts: per id matchen, Innenleben mit svMergeAct mergen (Acts selbst kommen/gehen nie im Alltag).
function svMergeDeepListActs(baseArr, mineArr, theirsArr, out) {
  const B = new Map((baseArr || []).map(o => [o.id, o]));
  const M = new Map((mineArr || []).map(o => [o.id, o]));
  const ids = [...new Set([...(theirsArr || []).map(o => o.id), ...(mineArr || []).map(o => o.id)])];
  return ids.map(id => {
    const t = (theirsArr || []).find(o => o.id === id);
    const m = M.get(id), b = B.get(id);
    if (t && m) return svMergeAct(b, m, t, out);
    return t || m;                                       // nur auf einer Seite vorhanden -> uebernehmen
  });
}

// Auto-Merge ausfuehren und Ergebnis in den laufenden Zustand uebernehmen.
// Raeumt Auswahlen und Undo-Historie (Merge = neue Baseline), cached sofort.
function svApplyMerge(mergedState, remoteSerialized) {
  state = mergedState;
  mbSel = []; mbSelConn = null; archSel = [];            // Auswahl koennte Geloeschtes referenzieren
  editingId = null;
  svSaveBase(remoteSerialized);                          // Fremd-Stand ist die neue Basis
  svCacheState(JSON.stringify(state));
  histInit();                                            // Undo ueber einen Merge hinweg waere gefaehrlich
  render();
}

// Ist gerade "Ruhe" fuer einen stillen Merge? (Kein Editor/Crop offen, kein Textfeld fokussiert.)
function svIdleForMerge() {
  if (editingId || docEditKind || (typeof mbCropId !== "undefined" && mbCropId)) return false;
  const ae = document.activeElement;
  if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return false;
  return true;
}

// Fremden Repo-Stand holen (gehostet /api/state mit Statik-Fallback, lokal statisch).
async function svFetchRemoteState() {
  if (IS_HOSTED) {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (res.ok) return await res.json();
    } catch (_) {}
  }
  const res = await fetch("roadmap.json", { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return await res.json();
}


/* ---------- Juli-Modus (Eisbär) ---------- */
function juliToast(msg) {
  const old = document.getElementById("juliToast"); if (old) old.remove();
  const t = document.createElement("div");
  t.id = "juliToast"; t.className = "juli-toast"; t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 400); }, 2400);
}
(function wireJuli() {
  const bear = document.getElementById("juliBear"); if (!bear) return;
  const toggle = () => {
    const on = document.body.classList.toggle("juli");
    bear.textContent = on ? "🐱" : "🐻‍❄️";        // Juli = Katze, Alex = Eisbär
    juliToast(on ? "❤️ Juli-Modus aktiviert ❤️" : "Juli-Modus deaktiviert");
  };
  bear.addEventListener("click", toggle);
  bear.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
})();

document.querySelectorAll(".nav-item").forEach(b =>
  b.addEventListener("click", () => {
    const v = b.dataset.view;
    if (v === "architecture") {
      // Kopf klicken: Unterpunkte auf/zu + leeres Draft-Canvas oeffnen.
      if (currentView() === "architecture") archExpanded = !archExpanded;
      else archExpanded = true;
      activeDiagramId = null;
      archDraft = { nodes: [], edges: [] };
      draftName = "";
      archSel = [];
      viewByDiagram["__draft"] = { tx: 0, ty: 0, s: 1 };
    }
    if (v === "moodboard") {
      if (currentView() === "moodboard") mbExpanded = !mbExpanded;
      else mbExpanded = true;
      activeBoardId = null; mbSel = [];
      mbDraft = { elements: [], connections: [] };
      mbDraftName = "";
      mbViewByBoard["__draft"] = { tx: 0, ty: 0, s: 1 };
    }
    setActiveView(v);
    render();
  }));

// Ordner-anlegen-Button neben dem "Moodboard"-Eintrag: nicht den Nav-Klick mit ausloesen.
(function wireNewFolder() {
  const nf = $("#mbNewFolder"); if (!nf) return;
  nf.addEventListener("click", e => {
    e.stopPropagation();
    setActiveView("moodboard"); mbExpanded = true;
    render();
    mbAddFolder();
  });
})();

$("#btnOpen").addEventListener("click", openFile);
$("#btnSave").addEventListener("click", saveFile);
$("#btnExport").addEventListener("click", exportJson);
// Verwerfen: ungespeicherten Arbeitsstand wegwerfen und den gespeicherten Stand laden.
// Bewusst simpel: Cache leeren + Reload — boot() laedt dann frisch und setzt die
// Merge-Basis sauber neu (kein zweiter Lade-Codepfad, der auseinanderlaufen koennte).
let svDiscarding = false;                                 // Verwerfen laeuft: pagehide darf NICHT zuruecksichern
$("#statusMsg").addEventListener("click", svStatusPanelToggle);
(function svStatusPanelResize() {                          // Panel-Breite per Griff ziehen, wird gemerkt
  const p = $("#statusPanel"), grip = $("#statusPanelGrip");
  if (!p || !grip) return;
  const saved = parseInt(localStorage.getItem("sv_statusPanelW") || "", 10);
  if (saved >= 240 && saved <= 720) p.style.width = saved + "px";
  grip.addEventListener("pointerdown", e => {
    e.preventDefault(); grip.setPointerCapture(e.pointerId);
    const move = ev => {
      const w = Math.min(720, Math.max(240, window.innerWidth - ev.clientX));
      p.style.width = w + "px";
    };
    const up = () => {
      grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up);
      try { localStorage.setItem("sv_statusPanelW", parseInt(p.style.width, 10)); } catch (_) {}
    };
    grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up);
  });
})();
$("#btnDiscard").addEventListener("click", () => {
  if (!confirm("Ungespeicherte \u00c4nderungen verwerfen und den gespeicherten Stand laden?")) return;
  svDiscarding = true;
  try { localStorage.removeItem(SV_STATE_KEY); } catch (_) {}
  location.reload();
});
$("#btnAdd").addEventListener("click", () => {
  const v = currentView();
  if (v === "changelog" || v === "docs") {
    const act = activeAct();
    const isCl = v === "changelog";
    const entry = isCl
      ? { id: "cl-"+Date.now().toString(36), title:"", body:"", rev:"", date: new Date().toISOString().slice(0,10) }
      : { id: "doc-"+Date.now().toString(36), title:"", body:"" };
    if (isCl) act.changelog.unshift(entry); else act.docs.push(entry);
    inlineEditId = entry.id;
    dirty = true;
    render();
  } else if (v === "architecture") {
    openArchEditor(null);
  } else {
    openEditor(null);
  }
});
$("#modalClose").addEventListener("click", closeEditor);
$("#btnCancel").addEventListener("click", closeEditor);
$("#btnSaveCard").addEventListener("click", saveCard);
$("#btnDelete").addEventListener("click", deleteCard);
$("#modalBackdrop").addEventListener("click", e => { if (e.target === $("#modalBackdrop")) closeEditor(); });

$("#docModalClose").addEventListener("click", closeDocEditor);
$("#dBtnCancel").addEventListener("click", closeDocEditor);
$("#dBtnSave").addEventListener("click", saveDocEntry);
$("#dBtnDelete").addEventListener("click", deleteDocEntry);
$("#docModalBackdrop").addEventListener("click", e => { if (e.target === $("#docModalBackdrop")) closeDocEditor(); });

$("#archModalClose").addEventListener("click", closeArchEditor);
$("#aBtnCancel").addEventListener("click", closeArchEditor);
$("#aBtnSave").addEventListener("click", saveArchNode);
$("#aBtnDelete").addEventListener("click", deleteArchNode);
$("#archModalBackdrop").addEventListener("click", e => { if (e.target === $("#archModalBackdrop")) closeArchEditor(); });

$("#edgeModalClose").addEventListener("click", closeEdgeEditor);
$("#eBtnCancel").addEventListener("click", closeEdgeEditor);
$("#eBtnSave").addEventListener("click", saveEdgeLabel);
$("#eBtnDelete").addEventListener("click", deleteEdgeFromEditor);
$("#edgeModalBackdrop").addEventListener("click", e => { if (e.target === $("#edgeModalBackdrop")) closeEdgeEditor(); });

// Diagrammname (Overlay oben links). Live in Draft bzw. Diagramm schreiben,
// nur die Sidebar-Liste aktualisieren, damit der Fokus im Feld bleibt.
$("#archName").addEventListener("input", () => {
  const val = $("#archName").value;
  if (activeDiagramId == null) { draftName = val; }
  else {
    const d = archData().diagrams.find(x => x.id === activeDiagramId);
    if (d) { d.name = val.trim(); dirty = true; }
  }
  renderArchSubnav(currentView());
});
$("#archZoom").addEventListener("click", e => {
  const z = e.target.dataset.z;
  if (z === "in") archZoomBy(1.2);
  else if (z === "out") archZoomBy(1 / 1.2);
  else if (z === "reset") archZoomReset();
});

// Moodboard: Element-Palette, Board-Name, Zoom
$("#mbPalette").addEventListener("click", e => {
  const t = e.target.dataset.add;
  if (t) mbAddElement(t);
});
$("#mbSnapChk").addEventListener("change", () => { state.meta.mbSnap = $("#mbSnapChk").checked; dirty = true; });
$("#mbGuideCol").addEventListener("input", () => { state.meta.mbGuideColor = $("#mbGuideCol").value; dirty = true; });
$("#mbName").addEventListener("input", () => {
  const val = $("#mbName").value;
  if (activeBoardId == null) { mbDraftName = val; }
  else {
    const b = mbData().boards.find(x => x.id === activeBoardId);
    if (b) { b.name = val.trim(); dirty = true; }
  }
  renderMbSubnav(currentView());
});
$("#mbZoom").addEventListener("click", e => {
  const z = e.target.dataset.z;
  if (z === "in") mbZoomBy(1.2);
  else if (z === "out") mbZoomBy(1 / 1.2);
  else if (z === "reset") mbZoomReset();
});

// Bild per Strg+V einfuegen (nur im Moodboard): echtes Bild ODER eine Bild-Referenz/URL.
document.addEventListener("paste", e => {
  if (currentView() !== "moodboard") return;
  if (mbMidPan) { e.preventDefault(); return; }          // vom Mittelklick ausgeloester Paste -> ignorieren
  const cd = e.clipboardData; if (!cd) return;
  // 1) echtes Bild in der Zwischenablage
  let blob = null;
  for (const it of cd.items || []) if (it.type && it.type.startsWith("image/")) { blob = it.getAsFile(); break; }
  if (blob) { e.preventDefault(); mbInsertImage(blob); return; }
  // 2) Referenz/URL auf ein Bild -> herunterladen, einbetten, speichern
  const url = mbExtractImageUrl(cd);
  if (url) { e.preventDefault(); mbInsertImageFromUrl(url); }
});
// Bild-URL aus der Zwischenablage ziehen (HTML-<img>, uri-list oder reiner Link).
function mbExtractImageUrl(cd) {
  const html = cd.getData("text/html");
  if (html) { const m = html.match(/<img[^>]+src=["']([^"']+)["']/i); if (m) return m[1]; }
  const uri = cd.getData("text/uri-list");
  if (uri) { const first = uri.split(/\s+/).find(s => /^https?:\/\//i.test(s)); if (first) return first; }
  const txt = (cd.getData("text/plain") || "").trim();
  if (/^https?:\/\/\S+$/i.test(txt)) return txt;
  return null;
}
// URL herunterladen -> Blob -> wie ein eingefuegtes Bild behandeln.
async function mbInsertImageFromUrl(url) {
  if (!IS_HOSTED) {                                      // gehostet uebernimmt mbInsertImageHosted den Upload
    const dir = await mbEnsureDir();                     // zuerst (frische Geste), dann laden
    if (!dir) { setStatus("Kein Ordnerzugriff — Bild nicht gespeichert.", "warn"); return; }
  }
  setStatus("Bild wird geladen…", "");
  let blob = null;
  try { const r = await fetch(url, { mode: "cors" }); if (r.ok) { const b = await r.blob(); if (b.type.startsWith("image/")) blob = b; } } catch { }
  if (!blob) blob = await mbBlobFromImgUrl(url).catch(() => null);   // Fallback ueber <img>+Canvas
  if (!blob) { setStatus("Bild konnte nicht geladen werden (Quelle erlaubt keinen Zugriff).", "warn"); return; }
  mbInsertImage(blob);
}
function mbBlobFromImgUrl(url) {
  return new Promise((res, rej) => {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => { const cv = document.createElement("canvas"); cv.width = img.naturalWidth; cv.height = img.naturalHeight; cv.getContext("2d").drawImage(img, 0, 0); cv.toBlob(b => b ? res(b) : rej(new Error("toBlob")), "image/png"); };
    img.onerror = () => rej(new Error("load"));
    img.src = url;
  });
}
// Mittelklick-Paste unterbinden: Chromium feuert beim Mittelklick ein echtes paste-Event, das den
// Objekt-Paste-Handler (weiter unten) ausloest. Die Maus-Events mousedown/mouseup sind fuer Taste 1
// unterdrueckt (Canvas-pointerdown ruft preventDefault fuers Schieben), daher stempeln wir ueber die
// Pointer-/auxclick-Events, die fuer Taste 1 zuverlaessig feuern — auch beim LOSLASSEN, denn genau
// dann feuert der Paste. Ein paste kurz nach einem Mittelklick wird in der Capture-Phase (zuerst
// registriert) verworfen, bevor der Objekt-Paste-Handler drankommt. Strg+V bleibt unberuehrt.
let midClickTs = 0;
const markMidClick = e => { if (e.button === 1) midClickTs = performance.now(); };
document.addEventListener("pointerdown", markMidClick, true);
document.addEventListener("pointerup", markMidClick, true);   // feuert beim Loslassen -> auch bei gehaltener Taste frisch
document.addEventListener("auxclick", markMidClick, true);
document.addEventListener("paste", e => {
  if (performance.now() - midClickTs < 400) { e.preventDefault(); e.stopImmediatePropagation(); }   // vom Mittelklick -> verwerfen
}, true);
// Auswahl merken + Farbe/Format am Cursor in die Text-Toolbar spiegeln.
document.addEventListener("selectionchange", () => {
  if (mbEditId == null || !mbEditNode) return;
  const s = getSelection(); if (!s.rangeCount) return;
  const r = s.getRangeAt(0);
  if (!mbEditNode.contains(r.commonAncestorContainer)) return;   // Auswahl ausserhalb des Editors -> ignorieren
  mbEditRange = r.cloneRange();
  mbUpdateTextToolbar();
});
// Klick ausserhalb einer offenen Notiz schliesst sie (Pin/Popover stoppen die Propagation selbst).
document.addEventListener("pointerdown", e => {
  if (mbNoteOpenId != null && !(e.target.closest && (e.target.closest(".mb-note-pop") || e.target.closest(".mb-note-pin")))) mbCloseNote();
});
// Gemerktes docs/-Handle vorab laden (Berechtigung wird erst beim ersten Paste geprueft).
mbLoadHandle().then(h => { if (h) mbDirHandle = h; });
svLoadFileHandle().then(h => { if (h && !fileHandle) fileHandle = h; });   // Datei-Handle nach Reload wiederherstellen
window.addEventListener("pagehide", () => { if (state && !svDiscarding) svWriteState(JSON.stringify(state)); });   // beim Reload aktuellen Stand sichern — ausser beim Verwerfen

document.addEventListener("keydown", e => {
  // Focus-Mode: TAB blendet in der Moodboard-Ansicht alles ausser Toolbar + Canvas aus (nicht beim Tippen).
  if (e.key === "Tab" && currentView() === "moodboard") {
    const ae = document.activeElement;
    const editing = ae && (ae.isContentEditable || ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT");
    if (!editing) {
      e.preventDefault();
      const on = document.body.classList.toggle("mb-focus");
      setStatus(on ? "Focus-Mode an — TAB blendet wieder ein." : "Focus-Mode aus.", "");
    }
  }
  if (e.key === "Escape") { closeEditor(); closeDocEditor(); closeArchEditor(); closeEdgeEditor(); if (currentView() === "moodboard") { if (mbLink || mbPending || mbReassign || mbEpDrag) { mbLink = null; mbPending = null; mbReassign = null; mbEpDrag = null; drawMbConnections(); setStatus("Abgebrochen.", ""); } else if (mbSel.length || mbSelConn != null) mbDeselectAll(); } else if (currentView() === "architecture" && archSel.length) { archSel = []; archApplySelection(); } }
  if ((e.key === "Delete" || e.key === "Backspace") && currentView() === "moodboard") {
    const ae = document.activeElement;
    const editing = ae && (ae.isContentEditable || ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT");
    if (editing) return;                                 // beim Tippen nichts loeschen
    if (mbCropId != null) return;                        // im Zuschneide-Modus nichts loeschen
    if (mbSelConn != null) { e.preventDefault(); mbDeleteConnection(mbSelConn); }
    else if (mbSel.length) { e.preventDefault(); mbDeleteSelection(); }
  }
  if ((e.key === "Delete" || e.key === "Backspace") && currentView() === "architecture" && archSel.length) {
    const ae = document.activeElement;
    const editing = ae && (ae.isContentEditable || ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT");
    if (!editing) { e.preventDefault(); archDeleteSelection(); }
  }
  // Rückgängig / Wiederherstellen (Strg+Z, Strg+Umschalt+Z, Strg+Y) — nicht beim Text-Editieren.
  if ((e.ctrlKey || e.metaKey) && !e.altKey && state) {
    const ae = document.activeElement;
    const editing = ae && (ae.isContentEditable || ae.tagName === "INPUT" || ae.tagName === "TEXTAREA");
    if (editing) return;                                 // natives Text-Undo nicht stoeren
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); histUndo(); }
    else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); histRedoAction(); }
  }
});
// History: nach jeder abgeschlossenen Geste aufnehmen (Diff sorgt dafuer, dass nur echte Aenderungen zaehlen).
document.addEventListener("pointerup", () => histRecord());
document.addEventListener("keyup", e => {
  const ae = document.activeElement;
  if (ae && (ae.isContentEditable || ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;  // Tippen laeuft separat
  histTouch();
});
// Datei-Drops ausserhalb des Canvas nicht vom Browser oeffnen lassen.
document.addEventListener("dragover", e => { if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault(); });
document.addEventListener("drop", e => { if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault(); });

// Kopieren (Strg+C): ausgewaehlte Objekte als markierten Text in die Zwischenablage legen.
document.addEventListener("copy", e => {
  const ae = document.activeElement;
  if (ae && (ae.isContentEditable || ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;  // natives Text-Kopieren
  const v = currentView();
  let data = null;
  if (v === "moodboard" && mbSel.length) { data = mbCopyData(); svClip = data; }
  else if (v === "architecture" && archSel.length) data = archCopyData();
  if (!data) return;
  e.clipboardData.setData("text/plain", "SVCLIP:" + JSON.stringify(data));
  e.preventDefault();
  const n = data.kind === "mb" ? data.els.length : data.nodes.length;
  setStatus(n + " kopiert.", "");
});
// Einfuegen (Strg+V): Objekt-Clip vor Bild/Text-Paste behandeln (capture -> laeuft zuerst).
document.addEventListener("paste", e => {
  const ae = document.activeElement;
  if (ae && (ae.isContentEditable || ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;   // natives Text-Einfuegen
  const cd = e.clipboardData; if (!cd) return;
  const txt = cd.getData("text/plain") || "";
  if (!txt.startsWith("SVCLIP:")) return;              // kein Objekt-Clip -> Bild/URL-Paste laeuft weiter
  let data; try { data = JSON.parse(txt.slice(7)); } catch { return; }
  const v = currentView();
  if (data.kind === "mb" && v === "moodboard") { e.preventDefault(); e.stopImmediatePropagation(); mbPasteData(data); }
  else if (data.kind === "arch" && v === "architecture") { e.preventDefault(); e.stopImmediatePropagation(); archPasteData(data); }
}, true);

window.addEventListener("beforeunload", e => { if (dirty && !svDiscarding) { e.preventDefault(); e.returnValue=""; } });   // Verwerfen wurde schon bestaetigt -> keine Doppel-Abfrage

// ---------- Sidebar-Breite ziehbar (Griff an der rechten Kante) ----------
// Breite wird in localStorage gemerkt. Unter dem Mobile-Breakpoint (720px) deaktiviert,
// damit die responsive Zeilen-Ansicht nicht durch eine feste Inline-Breite zerbricht.
(function initSidebarResize() {
  const sb = document.querySelector(".sidebar"); if (!sb) return;
  const MINW = 150, MAXW = 480, BP = 720;
  const wide = () => window.innerWidth > BP;
  // localStorage kann in manchen file://-Umgebungen werfen -> defensiv kapseln, damit boot() nie ausfaellt.
  const readW  = () => { try { return parseInt(localStorage.getItem("sv_sidebarW") || "", 10); } catch (_) { return NaN; } };
  const saveW  = w => { try { localStorage.setItem("sv_sidebarW", String(w)); } catch (_) {} };

  const applyWidth = w => { sb.style.width = w + "px"; sb.style.flexBasis = w + "px"; };
  const clearWidth = () => { sb.style.width = ""; sb.style.flexBasis = ""; };

  if (wide()) { const saved = readW(); if (saved >= MINW && saved <= MAXW) applyWidth(saved); }

  const grip = document.createElement("div");
  grip.className = "sidebar-resizer"; grip.title = "Breite ziehen";
  sb.appendChild(grip);

  let startX = 0, startW = 0;
  grip.addEventListener("pointerdown", e => {
    if (!wide()) return;
    e.preventDefault();
    startX = e.clientX; startW = sb.getBoundingClientRect().width;
    grip.classList.add("dragging"); grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener("pointermove", e => {
    if (!grip.hasPointerCapture(e.pointerId)) return;
    const w = Math.max(MINW, Math.min(MAXW, startW + (e.clientX - startX)));
    applyWidth(w);
  });
  grip.addEventListener("pointerup", e => {
    if (!grip.classList.contains("dragging")) return;
    grip.classList.remove("dragging");
    try { grip.releasePointerCapture(e.pointerId); } catch (_) {}
    saveW(Math.round(sb.getBoundingClientRect().width));
  });

  // Beim Wechsel unter/ueber den Breakpoint die feste Breite entfernen bzw. wiederherstellen.
  window.addEventListener("resize", () => {
    if (!wide()) clearWidth();
    else { const s = readW(); if (s >= MINW && s <= MAXW) applyWidth(s); }
  });
})();

boot();

// --- Revision-Banner (Sync-Schritt 2): faellt Konflikten auf, WAEHREND man arbeitet ---
// Alle 2 Min (und kurz nach dem Laden) still die aktuelle Revision holen. Ist das Repo
// weiter als der Arbeitsstand: dezentes, nicht blockierendes Banner mit Reload-Aktion.
// Wegklicken merkt sich die Rev; Check-Fehler (offline) raeumt das Banner still weg.
const SV_REV_CHECK_MS = 2 * 60 * 1000;
let svRevDismissed = 0;

async function svFetchRemoteRevision() {
  // Gehostet: /api/state (Repo-frisch); faellt der Endpunkt aus, degradiert der Check
  // auf die statische roadmap.json — die hinkt nur bis zum naechsten Deploy hinterher.
  // (Gleiche Verteidigung wie im Boot-Check; sie hat den /api-Ausfall vom 15.07. abgefangen.)
  if (IS_HOSTED) {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (res.ok) { const j = await res.json(); return (j.meta && j.meta.revision) || 0; }
    } catch (_) {}
  }
  const res = await fetch("roadmap.json", { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const j = await res.json();
  return (j.meta && j.meta.revision) || 0;
}

function svRemoveRevBanner() { const b = $("#svRevBanner"); if (b) b.remove(); }

function svShowRevBanner(remoteRev, localRev) {
  svRemoveRevBanner();
  const b = document.createElement("div");
  b.id = "svRevBanner";
  // Inline-Styles, damit roadmap.css unangetastet bleibt (bewusst; s. Ticket-Notiz).
  b.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:9999;display:flex;gap:10px;" +
    "align-items:center;padding:10px 14px;border-radius:10px;font-size:13px;" +
    "background:rgba(30,34,44,.95);color:#e8eaf0;border:1px solid rgba(255,255,255,.18);" +
    "box-shadow:0 4px 16px rgba(0,0,0,.35);";
  const txt = document.createElement("span");
  txt.textContent = "Es gibt inzwischen Rev " + remoteRev + " (du arbeitest auf Rev " + localRev + ").";
  const take = document.createElement("button");
  take.textContent = "\u00dcbernehmen";
  take.style.cssText = "padding:4px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.3);" +
    "background:transparent;color:inherit;cursor:pointer;font:inherit;";
  take.addEventListener("click", async () => {
    if (await svTrySilentMerge()) return;                // erledigt inkl. Banner-Abbau
    setStatus("Zusammenfuehren nicht moeglich (gleiches Objekt geaendert oder keine Basis) — bitte neu laden.","warn");
  });
  const reload = document.createElement("button");
  reload.textContent = "Neu laden";
  reload.style.cssText = "padding:4px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.3);" +
    "background:transparent;color:inherit;cursor:pointer;font:inherit;";
  reload.addEventListener("click", () => location.reload());   // Boot-Dialog uebernimmt bei dirty
  const close = document.createElement("button");
  close.textContent = "\u00d7";
  close.setAttribute("aria-label", "Hinweis schliessen");
  close.style.cssText = "border:none;background:transparent;color:inherit;cursor:pointer;" +
    "font-size:16px;line-height:1;padding:0 2px;";
  close.addEventListener("click", () => { svRevDismissed = remoteRev; svRemoveRevBanner(); });
  b.append(txt, take, reload, close);
  document.body.appendChild(b);
}

async function svRevisionCheck() {
  if (!state || !state.meta) return;
  try {
    const remote = await svFetchRemoteRevision();
    const local = state.meta.revision || 0;
    if (remote > local && remote > svRevDismissed) {
      // Sync 3a: bei Ruhe (kein Editor/Textfeld offen) still zusammenfuehren statt Banner.
      if (svIdleForMerge() && await svTrySilentMerge()) return;
      svShowRevBanner(remote, local);
    }
    else svRemoveRevBanner();
  } catch (_) { svRemoveRevBanner(); }                     // offline o.ae.: still bleiben
}

// Fremden Stand holen, mergen, bei Erfolg uebernehmen. true = erledigt (kein Banner noetig).
async function svTrySilentMerge() {
  try {
    const theirs = await svFetchRemoteState();
    const mres = svMerge3(svLoadBase(), JSON.parse(JSON.stringify(state)), theirs);
    if (!mres.ok) return false;                          // Konflikt/keine Basis -> Banner soll erscheinen
    svApplyMerge(mres.state, JSON.stringify(theirs));
    svRemoveRevBanner();
    setStatus("Aenderungen uebernommen: " + mres.fromTheirs + " von anderen, deine bleiben erhalten (Rev " +
              ((state.meta && state.meta.revision) || 0) + ").","ok");
    return true;
  } catch (_) { return false; }
}

setTimeout(svRevisionCheck, 15 * 1000);                    // erster Check kurz nach dem Laden
setInterval(svRevisionCheck, SV_REV_CHECK_MS);
