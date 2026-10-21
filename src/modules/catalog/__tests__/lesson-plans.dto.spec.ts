import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate, ValidationError } from "class-validator";
import { CreateLessonPlanDto } from "../dto/create-lesson-plan.dto";
import { UpdateLessonPlanDto } from "../dto/update-lesson-plan.dto";

const VALID_BODY = {
  title: "Teclado, mouse e janelas",
  expectedDurationMinutes: 90,
  contents: ["Teclado e mouse", "Janelas do sistema"],
};

function fieldsOf(errors: ValidationError[]): string[] {
  return errors.map((error) => error.property).sort();
}

async function checkCreate(body: Record<string, unknown>) {
  const dto = plainToInstance(CreateLessonPlanDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: fieldsOf(errors) };
}

async function checkUpdate(body: Record<string, unknown>) {
  const dto = plainToInstance(UpdateLessonPlanDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: fieldsOf(errors) };
}

describe("CreateLessonPlanDto", () => {
  it("accepts the plan 'Teclado, mouse e janelas' with 90 minutes and two contents", async () => {
    const { dto, errors } = await checkCreate(VALID_BODY);

    expect(errors).toHaveLength(0);
    expect(dto.title).toBe("Teclado, mouse e janelas");
    expect(dto.expectedDurationMinutes).toBe(90);
    expect(dto.contents).toEqual(["Teclado e mouse", "Janelas do sistema"]);
    expect(dto.objective).toBeUndefined();
    expect(dto.materialUrl).toBeUndefined();
  });

  it("reports field title when title is missing, blank or too long", async () => {
    const { title: _title, ...withoutTitle } = VALID_BODY;

    expect((await checkCreate(withoutTitle)).fields).toEqual(["title"]);
    expect((await checkCreate({ ...VALID_BODY, title: "   " })).fields).toEqual(["title"]);
    expect((await checkCreate({ ...VALID_BODY, title: null })).fields).toEqual(["title"]);
    expect((await checkCreate({ ...VALID_BODY, title: 12 })).fields).toEqual(["title"]);
    expect((await checkCreate({ ...VALID_BODY, title: "a".repeat(201) })).fields).toEqual([
      "title",
    ]);
    expect((await checkCreate({ ...VALID_BODY, title: "a".repeat(200) })).errors).toHaveLength(0);
  });

  it("trims the title", async () => {
    const { dto, errors } = await checkCreate({ ...VALID_BODY, title: "  Janelas  " });

    expect(errors).toHaveLength(0);
    expect(dto.title).toBe("Janelas");
  });

  it("reports field expectedDurationMinutes when it is missing, zero, negative, fractional or not a number", async () => {
    const { expectedDurationMinutes: _duration, ...withoutDuration } = VALID_BODY;

    expect((await checkCreate(withoutDuration)).fields).toEqual(["expectedDurationMinutes"]);
    for (const expectedDurationMinutes of [0, -1, -90, 90.5, "90", null, true]) {
      const { fields } = await checkCreate({ ...VALID_BODY, expectedDurationMinutes });
      expect(fields).toEqual(["expectedDurationMinutes"]);
    }
  });

  it("accepts durations from 1 to 1440 minutes and rejects 1441", async () => {
    expect((await checkCreate({ ...VALID_BODY, expectedDurationMinutes: 1 })).errors).toHaveLength(
      0,
    );
    expect(
      (await checkCreate({ ...VALID_BODY, expectedDurationMinutes: 1440 })).errors,
    ).toHaveLength(0);
    expect((await checkCreate({ ...VALID_BODY, expectedDurationMinutes: 1441 })).fields).toEqual([
      "expectedDurationMinutes",
    ]);
    expect(
      (await checkCreate({ ...VALID_BODY, expectedDurationMinutes: 2147483648 })).fields,
    ).toEqual(["expectedDurationMinutes"]);
  });

  it("reports field contents when contents is missing, empty or not a list", async () => {
    const { contents: _contents, ...withoutContents } = VALID_BODY;

    expect((await checkCreate(withoutContents)).fields).toEqual(["contents"]);
    expect((await checkCreate({ ...VALID_BODY, contents: [] })).fields).toEqual(["contents"]);
    expect((await checkCreate({ ...VALID_BODY, contents: null })).fields).toEqual(["contents"]);
    expect((await checkCreate({ ...VALID_BODY, contents: "Teclado e mouse" })).fields).toEqual([
      "contents",
    ]);
  });

  it("reports field contents when an item is blank, not a string or too long", async () => {
    for (const contents of [
      ["Teclado e mouse", ""],
      ["Teclado e mouse", "   "],
      ["Teclado e mouse", 3],
      ["Teclado e mouse", null],
      ["a".repeat(501)],
    ]) {
      const { fields } = await checkCreate({ ...VALID_BODY, contents });
      expect(fields).toEqual(["contents"]);
    }
  });

  it("trims each content and keeps the order", async () => {
    const { dto, errors } = await checkCreate({
      ...VALID_BODY,
      contents: ["  Pastas  ", "Janelas", " Teclado "],
    });

    expect(errors).toHaveLength(0);
    expect(dto.contents).toEqual(["Pastas", "Janelas", "Teclado"]);
  });

  it("accepts up to 50 contents and rejects 51", async () => {
    const contents = (total: number) => Array.from({ length: total }, (_, i) => `Conteúdo ${i}`);

    expect((await checkCreate({ ...VALID_BODY, contents: contents(50) })).errors).toHaveLength(0);
    expect((await checkCreate({ ...VALID_BODY, contents: contents(51) })).fields).toEqual([
      "contents",
    ]);
  });

  it("accepts http and https links in materialUrl", async () => {
    for (const materialUrl of [
      "https://drive.google.com/file/d/exemplo/view",
      "http://example.com/material.pdf",
      "https://example.com/aula?plano=1#parte-2",
    ]) {
      const { dto, errors } = await checkCreate({ ...VALID_BODY, materialUrl });

      expect(errors).toHaveLength(0);
      expect(dto.materialUrl).toBe(materialUrl);
    }
  });

  it("reports field materialUrl for anything that is not an http or https link", async () => {
    for (const materialUrl of [
      "not a url",
      "drive.google.com/file/d/exemplo/view",
      "ftp://example.com/material.pdf",
      "javascript:alert(1)",
      "https://",
      42,
      `https://example.com/${"a".repeat(500)}`,
    ]) {
      const { fields } = await checkCreate({ ...VALID_BODY, materialUrl });
      expect(fields).toEqual(["materialUrl"]);
    }
  });

  it("treats a blank or null materialUrl and objective as not informed", async () => {
    const blank = await checkCreate({ ...VALID_BODY, materialUrl: "  ", objective: "" });
    expect(blank.errors).toHaveLength(0);
    expect(blank.dto.materialUrl).toBeNull();
    expect(blank.dto.objective).toBeNull();

    const nulls = await checkCreate({ ...VALID_BODY, materialUrl: null, objective: null });
    expect(nulls.errors).toHaveLength(0);
    expect(nulls.dto.materialUrl).toBeNull();
    expect(nulls.dto.objective).toBeNull();
  });

  it("trims the objective and rejects one that is too long or not text", async () => {
    const { dto, errors } = await checkCreate({ ...VALID_BODY, objective: "  Aprender  " });
    expect(errors).toHaveLength(0);
    expect(dto.objective).toBe("Aprender");

    expect((await checkCreate({ ...VALID_BODY, objective: "a".repeat(2001) })).fields).toEqual([
      "objective",
    ]);
    expect((await checkCreate({ ...VALID_BODY, objective: 5 })).fields).toEqual(["objective"]);
  });

  it("reports every invalid field at once", async () => {
    const { fields } = await checkCreate({
      title: "",
      expectedDurationMinutes: 0,
      contents: [],
      materialUrl: "nope",
    });

    expect(fields).toEqual(["contents", "expectedDurationMinutes", "materialUrl", "title"]);
  });
});

describe("UpdateLessonPlanDto", () => {
  it("accepts an empty body and a partial body", async () => {
    expect((await checkUpdate({})).errors).toHaveLength(0);

    const { dto, errors } = await checkUpdate({ expectedDurationMinutes: 120, title: "  Novo  " });
    expect(errors).toHaveLength(0);
    expect(dto.expectedDurationMinutes).toBe(120);
    expect(dto.title).toBe("Novo");
    expect(dto.contents).toBeUndefined();
  });

  it("rejects null for title, expectedDurationMinutes and contents", async () => {
    const { fields } = await checkUpdate({
      title: null,
      expectedDurationMinutes: null,
      contents: null,
    });

    expect(fields).toEqual(["contents", "expectedDurationMinutes", "title"]);
  });

  it("applies the same rules as the create body to the fields sent", async () => {
    expect((await checkUpdate({ title: "   " })).fields).toEqual(["title"]);
    expect((await checkUpdate({ expectedDurationMinutes: 0 })).fields).toEqual([
      "expectedDurationMinutes",
    ]);
    expect((await checkUpdate({ expectedDurationMinutes: 1441 })).fields).toEqual([
      "expectedDurationMinutes",
    ]);
    expect((await checkUpdate({ contents: [] })).fields).toEqual(["contents"]);
    expect((await checkUpdate({ contents: ["Teclado", " "] })).fields).toEqual(["contents"]);
    expect((await checkUpdate({ materialUrl: "not a url" })).fields).toEqual(["materialUrl"]);
  });

  it("trims each content and keeps the order", async () => {
    const { dto, errors } = await checkUpdate({ contents: [" Janelas ", " Teclado "] });

    expect(errors).toHaveLength(0);
    expect(dto.contents).toEqual(["Janelas", "Teclado"]);
  });

  it("accepts null to clear objective and materialUrl, and a blank string means the same", async () => {
    const nulls = await checkUpdate({ objective: null, materialUrl: null });
    expect(nulls.errors).toHaveLength(0);
    expect(nulls.dto.objective).toBeNull();
    expect(nulls.dto.materialUrl).toBeNull();

    const blank = await checkUpdate({ objective: "  ", materialUrl: "" });
    expect(blank.errors).toHaveLength(0);
    expect(blank.dto.objective).toBeNull();
    expect(blank.dto.materialUrl).toBeNull();
  });
});
