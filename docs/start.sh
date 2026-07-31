#!/usr/bin/env bash
# StarVoyage lokal starten: winziger Webserver + Browser. Laeuft unter Linux und macOS.
# In denselben Ordner wie roadmap.html legen (docs/). Ausfuehrbar machen: chmod +x start.sh
# Starten: ./start.sh  (oder Doppelklick -> "Ausfuehren" / unter macOS ggf. Rechtsklick -> Oeffnen)
# Der Server sendet No-Cache-Header -> beim Reload kommen immer die frischen Dateien (kein Style-Cache).

cd "$(dirname "$0")" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 nicht gefunden."
  echo "  macOS: 'xcode-select --install' installiert es (Command Line Tools)."
  echo "  Linux: python3 ueber den Paketmanager installieren."
  exit 1
fi

PORT=8000
while lsof -i ":$PORT" >/dev/null 2>&1; do PORT=$((PORT+1)); done
URL="http://127.0.0.1:$PORT/roadmap.html"

if [ ! -f "roadmap.json" ]; then
  echo "!!  roadmap.json liegt NICHT in diesem Ordner:"
  echo "    $(pwd)"
  echo "    Lege sie hierher (neben roadmap.html), sonst wird sie nicht automatisch geladen."
  echo
fi

echo "StarVoyage:  $URL"
echo "Beenden: dieses Fenster schliessen oder Strg+C."
echo

open_browser() {
  if [ "$(uname)" = "Darwin" ]; then
    for app in "Google Chrome" "Chromium" "Brave Browser" "Microsoft Edge"; do
      if open -a "$app" "$URL" >/dev/null 2>&1; then return; fi
    done
    echo "(Kein Chromium-Browser gefunden -> Standardbrowser. Fuer 'Speichern' bitte Chrome nutzen.)"
    open "$URL"
  else
    for b in chromium chromium-browser google-chrome google-chrome-stable brave-browser; do
      if command -v "$b" >/dev/null 2>&1; then "$b" "$URL" >/dev/null 2>&1 & return; fi
    done
    echo "(Kein Chromium gefunden -> Standardbrowser. Fuer 'Speichern' bitte Chromium nutzen.)"
    xdg-open "$URL" >/dev/null 2>&1 &
  fi
}
( sleep 0.6; open_browser ) &

# Webserver mit No-Cache-Headern (verhindert, dass der Browser alte CSS/JS behaelt).
exec python3 - "$PORT" << 'PY'
import sys, http.server, socketserver
port = int(sys.argv[1])
class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", port), NoCacheHandler) as httpd:
	try:
	    httpd.serve_forever()
	except KeyboardInterrupt:
	    print("\nStarVoyage-Server beendet.")
PY
