import "reflect-metadata";
import { config } from "dotenv";
import { DataSource } from "typeorm";
import { normalizeSearchTerm } from "../search.util";

config();

const dbUrl = process.env.DATABASE_URL;
const dbConnection = dbUrl
  ? { url: dbUrl }
  : {
      host: process.env.DB_HOST ?? "localhost",
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USERNAME ?? "tedi",
      password: process.env.DB_PASSWORD ?? "tedi",
      database: process.env.DB_DATABASE ?? "tedi",
    };

describe("search_normalize (e2e)", () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: "postgres",
      ...dbConnection,
      ssl: dbUrl ? { rejectUnauthorized: false } : false,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  async function normalize(value: string | null): Promise<string | null> {
    const rows: Array<{ value: string | null }> = await dataSource.query(
      "SELECT public.search_normalize($1) AS value",
      [value],
    );
    return rows[0].value;
  }

  async function matching(values: string[], pattern: string): Promise<string[]> {
    const rows: Array<{ value: string }> = await dataSource.query(
      `SELECT value
         FROM unnest($1::text[]) AS candidates(value)
        WHERE public.search_normalize(value) LIKE public.search_normalize($2) ESCAPE '\\'`,
      [values, pattern],
    );
    return rows.map((row) => row.value).sort();
  }

  it("has unaccent and pg_trgm installed", async () => {
    const rows: Array<{ extname: string; schema: string }> = await dataSource.query(
      `SELECT e.extname, n.nspname AS schema
         FROM pg_extension e
         JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname IN ('unaccent', 'pg_trgm')
        ORDER BY e.extname`,
    );

    expect(rows).toEqual([
      { extname: "pg_trgm", schema: "public" },
      { extname: "unaccent", schema: "public" },
    ]);
  });

  it("is IMMUTABLE, PARALLEL SAFE and STRICT, as an index expression requires", async () => {
    const rows: Array<{ provolatile: string; proparallel: string; proisstrict: boolean }> =
      await dataSource.query(
        `SELECT p.provolatile, p.proparallel, p.proisstrict
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND p.proname = 'search_normalize'`,
      );

    expect(rows).toEqual([{ provolatile: "i", proparallel: "s", proisstrict: true }]);
  });

  it("normalizes accents and case", async () => {
    expect(await normalize("José da Conceição")).toBe("jose da conceicao");
    expect(await normalize("MÁRIA")).toBe("maria");
    expect(await normalize("mária")).toBe("maria");
    expect(await normalize("Ångström ÇÑ")).toBe("angstrom cn");
    expect(await normalize(null)).toBeNull();
  });

  it("treats escaped % and _ as literals", async () => {
    const values = ["50%", "500", "a_b", "axb", "back\\slash"];

    expect(await matching(values, "%50\\%%")).toEqual(["50%"]);
    expect(await matching(values, "%a\\_b%")).toEqual(["a_b"]);
    expect(await matching(values, "%back\\\\slash%")).toEqual(["back\\slash"]);
    expect(await matching(values, "%50%")).toEqual(["50%", "500"]);
    expect(await matching(values, "%a_b%")).toEqual(["a_b", "axb"]);
  });

  it("finds the literal text of a normalized term, look-alikes of % _ and \\ included", async () => {
    const values = ["50%", "50\uFF05", "500", "a_b", "a\uFF3Fb", "axb", "a\\b", "a\u2216b", "acb"];
    const search = async (term: string): Promise<string[]> =>
      matching(values, `%${normalizeSearchTerm(term)}%`);

    expect(await search("50%")).toEqual(["50%", "50\uFF05"]);
    expect(await search("50\uFF05")).toEqual(["50%", "50\uFF05"]);
    expect(await search("a_b")).toEqual(["a_b", "a\uFF3Fb"]);
    expect(await search("a\uFF3Fb")).toEqual(["a_b", "a\uFF3Fb"]);
    expect(await search("a\\b")).toEqual(["a\\b", "a\u2216b"]);
    expect(await search("a\u2216b")).toEqual(["a\\b", "a\u2216b"]);
  });
});
