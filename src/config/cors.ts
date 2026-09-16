/**
 * Origens permitidas para CORS, lidas de CORS_ORIGINS (lista separada por vírgula).
 *
 * Aceita origens exatas ("https://tedi-front.vercel.app") e curingas de subdomínio
 * ("https://*.vercel.app"), necessários para os previews do Vercel, que ganham
 * um subdomínio novo a cada PR.
 */

export const DEFAULT_CORS_ORIGINS = ["http://localhost:5173", "http://localhost:4173"];

export function parseCorsOrigins(
  raw: string | undefined,
  fallback = DEFAULT_CORS_ORIGINS,
): string[] {
  if (!raw || raw.trim() === "") return fallback;
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function isOriginAllowed(origin: string | undefined, allowed: string[]): boolean {
  // Requisições sem Origin (curl, health check, mesma origem) não são bloqueadas pelo CORS.
  if (!origin) return true;

  return allowed.some((pattern) => {
    if (pattern === "*") return true;
    if (!pattern.includes("*")) return pattern === origin;

    // "https://*.vercel.app" → protocolo fixo, qualquer subdomínio de um nível ou mais.
    const [protocol, hostPattern] = pattern.split("://");
    const [originProtocol, originHost] = origin.split("://");
    if (!hostPattern || !originHost || protocol !== originProtocol) return false;

    const suffix = hostPattern.replace(/^\*\./, "");
    return originHost === suffix || originHost.endsWith(`.${suffix}`);
  });
}
