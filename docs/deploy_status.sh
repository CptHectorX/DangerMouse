#!/usr/bin/env bash
# deploy_status.sh — zeigt die letzten Cloudflare-Pages-Deployments und ob der lokale
# HEAD-Commit live ist. Braucht nur: curl, python3, git — kein Node.
#
# Einmalige Konfiguration (NICHT ins Repo committen!):
#   ~/.config/starvoyage/deploy.env mit:
#     CF_API_TOKEN=<API-Token mit Permission "Account / Cloudflare Pages / Read">
#     CF_ACCOUNT_ID=<Account-ID von der Workers-&-Pages-Uebersichtsseite>
#
# Aufruf: ./deploy_status.sh   (aus dem Repo, egal welcher Ordner)

set -euo pipefail
PROJECT="starvoyage-prototype"
CONF="$HOME/.config/starvoyage/deploy.env"
[ -f "$CONF" ] && . "$CONF"

: "${CF_API_TOKEN:?CF_API_TOKEN fehlt — siehe Kommentar oben im Skript}"
: "${CF_ACCOUNT_ID:?CF_ACCOUNT_ID fehlt — siehe Kommentar oben im Skript}"

HEAD_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")

# Antwort in Variable statt Pipe: das Heredoc unten ist Pythons stdin —
# eine Pipe wuerde davon verdrAngt (genau das war der Bug der ersten Version).
RESP=$(curl -sS -H "Authorization: Bearer $CF_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/pages/projects/$PROJECT/deployments?per_page=5") \
  || { echo "curl fehlgeschlagen (Netz/Proxy?)"; exit 1; }

HEAD_SHA="$HEAD_SHA" RESP="$RESP" python3 <<'EOF'
import json, os, sys

raw = os.environ.get("RESP", "")
try:
    data = json.loads(raw)
except json.JSONDecodeError:
    print("Unerwartete API-Antwort (kein JSON):")
    print(raw[:500])
    sys.exit(1)

if not data.get("success"):
    print("API-Fehler:", data.get("errors"))
    sys.exit(1)

head = os.environ.get("HEAD_SHA", "")
deployments = data.get("result", [])

for d in deployments:
    meta = (d.get("deployment_trigger") or {}).get("metadata") or {}
    sha = meta.get("commit_hash") or ""
    msg = (meta.get("commit_message") or "").split("\n")[0][:52]
    stage = d.get("latest_stage") or {}
    status = f"{stage.get('name','?')}:{stage.get('status','?')}"
    env = d.get("environment", "?")
    when = (d.get("created_on") or "")[:19].replace("T", " ")
    mark = "  <- HEAD" if head and sha == head else ""
    print(f"{when}  {env:<10} {status:<16} {sha[:7]}  {msg}{mark}")

if head:
    live = any(
        ((d.get("deployment_trigger") or {}).get("metadata") or {}).get("commit_hash") == head
        and (d.get("latest_stage") or {}).get("status") == "success"
        and d.get("environment") == "production"
        for d in deployments
    )
    print()
    print(f"HEAD {head[:7]}:", "LIVE" if live else "noch NICHT live (oder Build laeuft)")
EOF
