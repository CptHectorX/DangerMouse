// docs/functions/api/image.js
// Cloudflare Pages Function: nimmt ein Moodboard-Bild (Base64) per POST entgegen
// und committet es via GitHub Contents API nach docs/images/<name>.
// Commit-Message enthaelt [CI Skip], damit Bild-Uploads keinen eigenen Deploy
// anstossen — das Bild wird mit dem naechsten roadmap.json-Save mitdeployt,
// und erst dann reist auch der Verweis zu den anderen Geraeten.
//
// Benoetigt dieselben Environment-Variablen wie save.js:
//   GITHUB_TOKEN (Secret), GITHUB_REPO, optional BRANCH (Default "main")
//
// Request-Body (JSON): { name: "mb-xxxx.png", data: "<Base64 ohne data:-Prefix>" }

const MAX_BYTES = 10 * 1024 * 1024;                       // 10 MB — weit ueber dem Normalfall nach mbDownscale(1200)

export async function onRequestPost(context) {
  const { request, env } = context;

  // Defense-in-depth: Cloudflare Access schuetzt die Seite bereits,
  // aber wir pruefen zusaetzlich, dass der Access-Header vorhanden ist.
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
  const name = String(body?.name || "");
  const data = String(body?.data || "");

  // Dateiname strikt validieren: nur das App-eigene Schema, keine Pfade/Sonderzeichen.
  if (!/^mb-[a-z0-9]+\.png$/.test(name)) {
    return json({ error: "Invalid image name" }, 400);
  }
  if (!data) {
    return json({ error: "Empty image data" }, 400);
  }
  // Base64 -> Bytes: ~3/4 der String-Laenge; Limit vor dem GitHub-Call pruefen.
  if (data.length * 0.75 > MAX_BYTES) {
    return json({ error: `Image too large (max ${MAX_BYTES / 1024 / 1024} MB)` }, 413);
  }

  const repo = env.GITHUB_REPO;
  const branch = env.BRANCH || "main";
  const apiBase = `https://api.github.com/repos/${repo}/contents/docs/images/${name}`;

  const ghHeaders = {
    "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "User-Agent": "starvoyage-roadmap-app",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  // Falls die Datei schon existiert (Namenskollision), braucht das Update ihren SHA.
  let sha;
  const getRes = await fetch(`${apiBase}?ref=${branch}`, { headers: ghHeaders });
  if (getRes.ok) {
    sha = (await getRes.json()).sha;
  } else if (getRes.status !== 404) {
    return json({ error: `GitHub GET failed: ${getRes.status}` }, 502);
  }

  const putRes = await fetch(apiBase, {
    method: "PUT",
    headers: { ...ghHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `images: add ${name} (${email}) [CI Skip]`,
      content: data,                                       // GitHub will Base64 — passt direkt
      branch,
      ...(sha ? { sha } : {}),
    }),
  });

  if (!putRes.ok) {
    const detail = await putRes.text();
    return json({ error: `GitHub PUT failed: ${putRes.status}`, detail }, 502);
  }

  const result = await putRes.json();
  return json({ ok: true, name, commit: result.commit?.sha, savedBy: email });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
