// docs/functions/api/state.js
// Cloudflare Pages Function: liefert die aktuelle roadmap.json direkt aus dem Repo
// (GitHub Contents API). Boot-Check und Revision-Banner der App nutzen das im
// gehosteten Betrieb, weil die statisch deployte roadmap.json nach einem Online-Save
// bis zum Redeploy hinterherhinkt (Tickets ga-mrl2n861, ga-mrly5w6x).
//
// Warum "state" und nicht "roadmap": Die Function-Datei hiess frueher roadmap.js —
// derselbe Name wie die App-Datei. Ein Kopier-Unfall hat die Function damit einmal
// ueberschrieben (Commit 9f8d0c8, /api/roadmap gab 404). Der neue Name macht diese
// Verwechslung strukturell unmoeglich.
//
// Benoetigt dieselben Environment-Variablen wie save.js:
//   GITHUB_TOKEN (Secret), GITHUB_REPO, FILE_PATH, optional BRANCH (Default "main")

export async function onRequestGet(context) {
  const { request, env } = context;

  // Defense-in-depth: Cloudflare Access schützt die Seite bereits,
  // aber wir prüfen zusätzlich, dass der Access-Header vorhanden ist.
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (!email) {
    return json({ error: "Not authenticated" }, 401);
  }

  const repo = env.GITHUB_REPO;
  const path = env.FILE_PATH || "docs/roadmap.json";
  const branch = env.BRANCH || "main";

  const res = await fetch(
    `https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`,
    {
      headers: {
        "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "User-Agent": "starvoyage-roadmap-app",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );
  if (!res.ok) {
    return json({ error: `GitHub GET failed: ${res.status}` }, 502);
  }

  const current = await res.json();
  const text = fromBase64(current.content);

  return new Response(text, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

// Base64 aus der GitHub-API (ggf. mit Zeilenumbrüchen) -> UTF-8-String.
// (Bewusst dupliziert aus save.js — Pages Functions sind hier je Datei eigenständig.)
function fromBase64(b64) {
  const bin = atob(String(b64).replace(/\n/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
