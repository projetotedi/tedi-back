// Verifica os pré-requisitos locais da skill do-task. Não imprime segredos.
// Uso: node check-connectors.mjs [--json]
import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

const out = { ok: true, checks: [] };
const add = (name, ok, detail, fix) => { out.checks.push({ name, ok, detail, fix }); if (!ok) out.ok = false; };
const run = (cmd, args, input) => spawnSync(cmd, args, { input, encoding: "utf8", env: { ...process.env, GCM_INTERACTIVE: "never", GIT_TERMINAL_PROMPT: "0" }, shell: false });

// 1. git
const git = run("git", ["--version"]);
add("git", git.status === 0, git.stdout.trim(), "Instalar Git for Windows");

// 2. credencial do GitHub salva no Git Credential Manager (token não sai do processo)
let login = null;
try {
  const cred = execSync("git credential fill", { input: "protocol=https\nhost=github.com\n", encoding: "utf8", env: { ...process.env, GCM_INTERACTIVE: "never" } });
  const token = cred.split("\n").find((l) => l.startsWith("password="))?.slice(9).trim();
  if (token) {
    const r = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "tedi-do-task" } });
    if (r.ok) login = (await r.json()).login;
    const org = await fetch("https://api.github.com/repos/projetotedi/tedi-back", { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "tedi-do-task" } });
    add("github.credential", !!login && org.ok, login ? `login ${login}; acesso a projetotedi/tedi-back: ${org.status}` : `GET /user falhou (${r.status})`, "Fazer um `git push` manual uma vez para o Git Credential Manager salvar a credencial da conta com acesso à org projetotedi");
  } else add("github.credential", false, "credential fill sem password", "git push manual uma vez");
} catch (e) { add("github.credential", false, String(e.message).split("\n")[0], "git push manual uma vez"); }
out.githubLogin = login;

// 3. crit (binário no PATH ou em ~/go/bin)
const goBin = join(os.homedir(), "go", "bin", process.platform === "win32" ? "crit.exe" : "crit");
const critWhich = run(process.platform === "win32" ? "where" : "which", ["crit"]);
const critPath = critWhich.status === 0 ? critWhich.stdout.trim().split("\n")[0] : existsSync(goBin) ? goBin : null;
if (critPath) {
  const v = run(critPath, ["--version"]);
  add("crit", true, `${critPath} ${v.stdout.trim() || v.stderr.trim()}`.trim());
} else {
  const go = run("go", ["version"]);
  add("crit", false, go.status === 0 ? `crit ausente; ${go.stdout.trim()} disponível` : "crit ausente e Go ausente",
    go.status === 0 ? "go install github.com/tomasz-tomczyk/crit/cmd/crit@latest  (e garantir a pasta go/bin do usuário no PATH)" : "Baixar crit-windows-amd64.exe em https://github.com/tomasz-tomczyk/crit/releases, renomear para crit.exe e colocar no PATH");
}
out.critPath = critPath;

// 4. node / yarn
const node = run("node", ["--version"]); add("node", node.status === 0, node.stdout.trim());
const yarn = process.platform === "win32" ? run("cmd", ["/c", "yarn --version"]) : run("yarn", ["--version"]); add("yarn", yarn.status === 0, yarn.stdout.trim(), "npm i -g yarn");

// 5. repositório atual e o repositório irmão (para cards que tocam os dois lados)
const top = run("git", ["rev-parse", "--show-toplevel"]);
const repoRoot = top.status === 0 ? top.stdout.trim() : null;
const repoName = repoRoot ? repoRoot.split(/[\\/]/).pop() : null;
add("repo", !!repoRoot && ["tedi-back", "tedi-front"].includes(repoName), repoRoot ? `${repoName} em ${repoRoot}` : "não está dentro de um clone git", "Rodar a skill a partir da raiz de tedi-back ou tedi-front");
if (repoRoot) {
  const sibling = repoName === "tedi-back" ? "tedi-front" : "tedi-back";
  const sp = join(repoRoot, "..", sibling);
  const has = existsSync(join(sp, ".git"));
  out.checks.push({ name: `sibling.${sibling}`, ok: true, detail: has ? sp : `ausente em ${sp} (só necessário para cards que tocam os dois repositórios)`, fix: has ? undefined : `git clone https://github.com/projetotedi/${sibling} ${sp}` });
}

if (process.argv.includes("--json")) console.log(JSON.stringify(out, null, 2));
else {
  for (const c of out.checks) console.log(`${c.ok ? "OK " : "FALHA"}  ${c.name.padEnd(20)} ${c.detail}${c.ok || !c.fix ? "" : `\n        → ${c.fix}`}`);
  console.log(out.ok ? "\nTudo pronto." : "\nHá pré-requisitos faltando. O Linear é verificado pela própria skill (ferramenta get_issue).");
}
process.exit(out.ok ? 0 : 1);
