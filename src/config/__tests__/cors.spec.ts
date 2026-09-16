import { DEFAULT_CORS_ORIGINS, isOriginAllowed, parseCorsOrigins } from "@config/cors";

describe("parseCorsOrigins", () => {
  it("usa o padrão local quando a variável está vazia", () => {
    expect(parseCorsOrigins(undefined)).toEqual(DEFAULT_CORS_ORIGINS);
    expect(parseCorsOrigins("   ")).toEqual(DEFAULT_CORS_ORIGINS);
  });

  it("separa por vírgula e ignora espaços e itens vazios", () => {
    expect(parseCorsOrigins(" https://a.com, https://b.com ,, ")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });
});

describe("isOriginAllowed", () => {
  const allowed = [
    "https://tedi-front.vercel.app",
    "https://*.vercel.app",
    "http://localhost:5173",
  ];

  it("permite requisição sem Origin", () => {
    expect(isOriginAllowed(undefined, allowed)).toBe(true);
  });

  it("permite origem exata", () => {
    expect(isOriginAllowed("https://tedi-front.vercel.app", allowed)).toBe(true);
    expect(isOriginAllowed("http://localhost:5173", allowed)).toBe(true);
  });

  it("permite subdomínio coberto por curinga", () => {
    expect(isOriginAllowed("https://tedi-front-git-feature-x.vercel.app", allowed)).toBe(true);
    expect(isOriginAllowed("https://a.b.vercel.app", allowed)).toBe(true);
  });

  it("rejeita protocolo diferente e domínio fora da lista", () => {
    expect(isOriginAllowed("http://tedi-front.vercel.app", allowed)).toBe(false);
    expect(isOriginAllowed("https://vercel.app.evil.com", allowed)).toBe(false);
    expect(isOriginAllowed("https://outro.com", allowed)).toBe(false);
  });

  it("aceita tudo com *", () => {
    expect(isOriginAllowed("https://qualquer.com", ["*"])).toBe(true);
  });
});
