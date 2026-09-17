// Abre (ou atualiza) um PR na org projetotedi usando a credencial do Git Credential Manager.
// O token fica dentro do processo; nunca é impresso.
// Uso: node github-pr.mjs <spec.json>
// spec: { repo, head, base?: "develop", title, bodyFile, assignees?: [login], labels?: [nome], createBaseFrom?: "main", draft?: false }
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
const owner = spec.owner ?? "projetotedi";
const base = spec.base ?? "develop";
const cred = execSync("git credential fill", { input: "protocol=https\nhost=github.com\n", encoding: "utf8", env: { ...process.env, GCM_INTERACTIVE: "never" } });
const token = cred.split("\n").find((l) => l.startsWith("password=")).slice(9).trim();
const H = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "tedi-do-task", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" };
const api = async (method, path, body) => {
  const r = await fetch(`https://api.github.com/repos/${owner}/${spec.repo}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!r.ok && !(method === "GET" && r.status === 404)) throw new Error(`${method} ${path} → ${r.status}: ${typeof json === "string" ? json : json.message} ${json.errors ? JSON.stringify(json.errors) : ""}`);
  return { status: r.status, json };
};

// Cores das labels espelhando as do Linear (criadas só se faltarem)
const LABEL_COLORS = { backend: "1d76db", frontend: "5319e7", infra: "0e8a16", feature: "a2eeef", improvement: "c5def5", bug: "d73a4a", migration: "fbca04", documentation: "0075ca" };

// 1. base existe? (opcionalmente cria a partir de createBaseFrom)
const baseRef = await api("GET", `/git/ref/heads/${base}`);
if (baseRef.status === 404) {
  if (!spec.createBaseFrom) throw new Error(`Branch base '${base}' não existe em ${owner}/${spec.repo}. Passe createBaseFrom:"main" para criar, ou mude a base.`);
  const from = await api("GET", `/git/ref/heads/${spec.createBaseFrom}`);
  await api("POST", "/git/refs", { ref: `refs/heads/${base}`, sha: from.json.object.sha });
  console.log(`branch '${base}' criada a partir de '${spec.createBaseFrom}'`);
}

// 2. labels faltantes
const existing = new Set((await api("GET", "/labels?per_page=100")).json.map((l) => l.name.toLowerCase()));
for (const name of spec.labels ?? []) {
  if (!existing.has(name.toLowerCase())) {
    await api("POST", "/labels", { name, color: LABEL_COLORS[name.toLowerCase()] ?? "ededed" });
    console.log(`label '${name}' criada`);
  }
}

// 3. PR (idempotente por head)
const body = readFileSync(spec.bodyFile, "utf8");
const open = (await api("GET", `/pulls?state=open&head=${owner}:${encodeURIComponent(spec.head)}`)).json;
let pr;
if (Array.isArray(open) && open.length) {
  pr = (await api("PATCH", `/pulls/${open[0].number}`, { title: spec.title, body, base })).json;
  console.log(`PR existente atualizado: #${pr.number}`);
} else {
  pr = (await api("POST", "/pulls", { title: spec.title, head: spec.head, base, body, draft: !!spec.draft })).json;
}

// 4. assignees e labels (via endpoint de issue)
await api("PATCH", `/issues/${pr.number}`, { assignees: spec.assignees ?? [], labels: spec.labels ?? [] });
console.log(`PR ${spec.repo}#${pr.number}: ${pr.html_url}`);
console.log(JSON.stringify({ number: pr.number, url: pr.html_url, base, head: spec.head }));
