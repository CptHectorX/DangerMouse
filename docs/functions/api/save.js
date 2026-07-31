// docs/functions/api/save.js
// Cloudflare Pages Function: nimmt die roadmap.json per POST entgegen
// und committet sie via GitHub Contents API ins Repo.
//
// Benötigte Environment-Variablen im Pages-Projekt:
//   GITHUB_TOKEN  (Secret) – fine-grained PAT, nur dieses Repo, Contents: Read/Write
//   GITHUB_REPO   – z.B. "Gosehawk-Software/StarVoyage_Prototype"
//   FILE_PATH     – z.B. "docs/roadmap.json"
//   BRANCH        – optional, Default "main"

export async function onRequestPost(context) {
  const { request, env } = context;

  // Defense-in-depth: Cloudflare Access schützt die Seite bereits,
  // aber wir prüfen zusätzlich, dass der Access-Header vorhanden ist.
  const email = request.headers.get("Cf-Access-Authenticated-User-Email");
  if (!email) {
    return json({ error: "Not authenticated" }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!body || typeof body !== "object") {
    return json({ error: "Empty payload" }, 400);
  }

  const repo = env.GITHUB_REPO;
  const path = env.FILE_PATH || "docs/roadmap.json";
  const branch = env.BRANCH || "main";
  const apiBase = `https://api.github.com/repos/${repo}/contents/${path}`;

  const ghHeaders = {
    "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "User-Agent": "starvoyage-roadmap-app",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // 1) Aktuellen SHA der Datei holen (GitHub verlangt ihn für Updates)
  const getRes = await fetch(`${apiBase}?ref=${branch}`, { headers: ghHeaders });
  if (!getRes.ok) {
    return json({ error: `GitHub GET failed: ${getRes.status}` }, 502);
  }
  const current = await getRes.json();

  // 1b) Konfliktschutz: Revision aus dem Repo-Stand lesen und mit der eingehenden vergleichen.
  // Verhindert, dass ein alter Browser-Tab einen neueren Stand überschreibt (Ticket ga-mrl2n861).
  try {
    const repoJson = JSON.parse(fromBase64(current.content));
    const repoRevision = (repoJson.meta && repoJson.meta.revision) || 0;
    const incomingRevision = (body.meta && body.meta.revision) || 0;
    if (incomingRevision <= repoRevision) {
      return json({ error: "Revision conflict", repoRevision, incomingRevision }, 409);
    }
  } catch (e) {
    // Repo-Datei nicht parsebar (sollte nie passieren) -> Guard überspringen statt Speichern blockieren
  }

  // 2) Neue Version committen
  const content = toBase64(JSON.stringify(body, null, 2) + "\n");
  const putRes = await fetch(apiBase, {
    method: "PUT",
    headers: { ...ghHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `roadmap: online edit (${email})`,
      content,
      sha: current.sha,
      branch,
    }),
  });

  if (!putRes.ok) {
    const detail = await putRes.text();
    return json({ error: `GitHub PUT failed: ${putRes.status}`, detail }, 502);
  }

  const result = await putRes.json();
  return json({ ok: true, commit: result.commit?.sha, savedBy: email });
}

// UTF-8-sicheres Base64 (btoa allein bricht bei Umlauten)
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// Gegenstück: Base64 aus der GitHub-API (ggf. mit Zeilenumbrüchen) -> UTF-8-String
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
