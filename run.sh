#!/bin/sh
# Startet DangerMouse ohne Editor.
#
#   ./run.sh              normal starten
#   ./run.sh --editor     im Editor oeffnen
#   GODOT=/pfad ./run.sh  andere Godot-Binary verwenden
#
# Warum der Import-Schritt: Godot konvertiert Assets nur im Editor oder wenn man
# es explizit verlangt. Ein normaler Start liest den Cache unter .godot/imported/,
# der nicht im Git liegt und beim rsync vom MacBook veraltet -- ein ersetztes Bild
# zeigt dann noch die alte Version, ein frisch dazugekommenes fehlt ganz.
set -e
cd "$(dirname "$0")" || exit 1

godot="${GODOT:-}"
if [ -n "$godot" ]; then
	# Explizit gesetzt: nicht suchen, sondern sauber meckern wenn es nicht passt.
	if ! command -v "$godot" >/dev/null 2>&1; then
		echo "Godot nicht gefunden oder nicht ausfuehrbar: $godot" >&2
		exit 1
	fi
else
	# Erst eigene/PATH-Namen (auf der Workstation greift hier der Snap godot-4),
	# dann ein portables Binary in ~/Downloads als Rueckfallebene.
	for candidate in \
			"$HOME/bin/godot4" godot4 godot-4 godot \
			"$HOME"/Downloads/Godot_v4*stable_linux.x86_64; do
		if command -v "$candidate" >/dev/null 2>&1; then
			godot="$candidate"
			break
		fi
	done
fi

if [ -z "$godot" ]; then
	echo "Godot nicht gefunden. Bitte GODOT=<pfad zur binary> setzen, z.B.:" >&2
	echo "  GODOT=/pfad/zu/godot ./run.sh" >&2
	exit 1
fi

case "$1" in
	--editor|-e)
		# Der Editor importiert selbst -- kein Vorlauf noetig.
		echo "Godot-Editor starten ($godot) ..."
		exec "$godot" --editor --path .
		;;
esac

echo "Assets importieren ..."
"$godot" --headless --path . --import >/dev/null
echo "Godot starten ($godot) ..."
exec "$godot" --path . "$@"
