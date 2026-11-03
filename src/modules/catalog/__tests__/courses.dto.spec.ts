import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate, ValidationError } from "class-validator";
import { flattenValidationErrors } from "@shared/filters/http-exception.filter";
import { CreateCourseDto } from "../dto/create-course.dto";
import { UpdateCourseDto } from "../dto/update-course.dto";
import { CourseCategory } from "../enums/course-category.enum";

const BASIC_ID = "01999a3e-7c1b-7000-8000-000000000001";
const INTERMEDIATE_ID = "01999a3e-7c1b-7000-8000-000000000002";

const VALID_BODY = {
  name: "Informática Básica",
  description: "Fundamentos do uso do computador.",
  category: "basic",
};

function fieldsOf(errors: ValidationError[]): string[] {
  return errors.map((error) => error.property).sort();
}

function messagesOf(errors: ValidationError[]): string[] {
  return flattenValidationErrors(errors)
    .map((error) => error.message)
    .sort();
}

function ids(total: number): string[] {
  return Array.from(
    { length: total },
    (_, index) => `01999a3e-7c1b-7000-8000-${String(index).padStart(12, "0")}`,
  );
}

async function checkCreate(body: Record<string, unknown>) {
  const dto = plainToInstance(CreateCourseDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: fieldsOf(errors) };
}

async function checkUpdate(body: Record<string, unknown>) {
  const dto = plainToInstance(UpdateCourseDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: fieldsOf(errors) };
}

describe("CreateCourseDto", () => {
  it("accepts the course 'Informática Básica' with category basic and no prerequisites", async () => {
    const { dto, errors } = await checkCreate(VALID_BODY);

    expect(errors).toHaveLength(0);
    expect(dto.name).toBe("Informática Básica");
    expect(dto.description).toBe("Fundamentos do uso do computador.");
    expect(dto.category).toBe(CourseCategory.BASIC);
    expect(dto.objective).toBeUndefined();
    expect(dto.prerequisiteIds).toBeUndefined();
  });

  it("accepts each of basic, intermediate and advanced", async () => {
    for (const category of ["basic", "intermediate", "advanced"]) {
      const { dto, errors } = await checkCreate({ ...VALID_BODY, category });

      expect(errors).toHaveLength(0);
      expect(dto.category).toBe(category);
    }
  });

  it("reports field name when name is missing, blank or too long", async () => {
    const { name: _name, ...withoutName } = VALID_BODY;

    expect((await checkCreate(withoutName)).fields).toEqual(["name"]);
    expect((await checkCreate({ ...VALID_BODY, name: "   " })).fields).toEqual(["name"]);
    expect((await checkCreate({ ...VALID_BODY, name: null })).fields).toEqual(["name"]);
    expect((await checkCreate({ ...VALID_BODY, name: 12 })).fields).toEqual(["name"]);
    expect((await checkCreate({ ...VALID_BODY, name: "a".repeat(201) })).fields).toEqual(["name"]);
    expect((await checkCreate({ ...VALID_BODY, name: "a".repeat(200) })).errors).toHaveLength(0);
  });

  it("reports field description when description is missing, blank or too long", async () => {
    const { description: _description, ...withoutDescription } = VALID_BODY;

    expect((await checkCreate(withoutDescription)).fields).toEqual(["description"]);
    expect((await checkCreate({ ...VALID_BODY, description: "   " })).fields).toEqual([
      "description",
    ]);
    expect((await checkCreate({ ...VALID_BODY, description: null })).fields).toEqual([
      "description",
    ]);
    expect((await checkCreate({ ...VALID_BODY, description: 12 })).fields).toEqual(["description"]);
    expect((await checkCreate({ ...VALID_BODY, description: "a".repeat(2001) })).fields).toEqual([
      "description",
    ]);
    expect(
      (await checkCreate({ ...VALID_BODY, description: "a".repeat(2000) })).errors,
    ).toHaveLength(0);
  });

  it("trims name and description", async () => {
    const { dto, errors } = await checkCreate({
      ...VALID_BODY,
      name: "  Informática Básica  ",
      description: "  Fundamentos.  ",
    });

    expect(errors).toHaveLength(0);
    expect(dto.name).toBe("Informática Básica");
    expect(dto.description).toBe("Fundamentos.");
  });

  it("reports field category when it is missing or outside basic, intermediate and advanced", async () => {
    const { category: _category, ...withoutCategory } = VALID_BODY;

    expect((await checkCreate(withoutCategory)).fields).toEqual(["category"]);
    for (const category of ["expert", "BASIC", "Basic", "", " basic", null, 1, true, ["basic"]]) {
      const { fields } = await checkCreate({ ...VALID_BODY, category });
      expect(fields).toEqual(["category"]);
    }
  });

  it("treats a blank or null objective as not informed", async () => {
    const blank = await checkCreate({ ...VALID_BODY, objective: "  " });
    expect(blank.errors).toHaveLength(0);
    expect(blank.dto.objective).toBeNull();

    const empty = await checkCreate({ ...VALID_BODY, objective: "" });
    expect(empty.errors).toHaveLength(0);
    expect(empty.dto.objective).toBeNull();

    const nothing = await checkCreate({ ...VALID_BODY, objective: null });
    expect(nothing.errors).toHaveLength(0);
    expect(nothing.dto.objective).toBeNull();
  });

  it("trims the objective and rejects one that is too long or not text", async () => {
    const { dto, errors } = await checkCreate({ ...VALID_BODY, objective: "  Aprender  " });
    expect(errors).toHaveLength(0);
    expect(dto.objective).toBe("Aprender");

    expect((await checkCreate({ ...VALID_BODY, objective: "a".repeat(2000) })).errors).toHaveLength(
      0,
    );
    expect((await checkCreate({ ...VALID_BODY, objective: "a".repeat(2001) })).fields).toEqual([
      "objective",
    ]);
    expect((await checkCreate({ ...VALID_BODY, objective: 5 })).fields).toEqual(["objective"]);
  });

  it("accepts prerequisiteIds omitted, empty or with distinct uuids", async () => {
    expect((await checkCreate(VALID_BODY)).errors).toHaveLength(0);

    const empty = await checkCreate({ ...VALID_BODY, prerequisiteIds: [] });
    expect(empty.errors).toHaveLength(0);
    expect(empty.dto.prerequisiteIds).toEqual([]);

    const some = await checkCreate({
      ...VALID_BODY,
      prerequisiteIds: [BASIC_ID, INTERMEDIATE_ID],
    });
    expect(some.errors).toHaveLength(0);
    expect(some.dto.prerequisiteIds).toEqual([BASIC_ID, INTERMEDIATE_ID]);
  });

  it("reports prerequisiteIds when it is not a list, has a non-uuid, has a duplicated id, has more than 20 or is null", async () => {
    for (const prerequisiteIds of [
      "not-a-list",
      BASIC_ID,
      { 0: BASIC_ID },
      ["not-a-uuid"],
      [BASIC_ID, "nope"],
      [BASIC_ID, 7],
      [BASIC_ID, null],
      [BASIC_ID, BASIC_ID],
      ids(21),
      null,
    ]) {
      const { fields } = await checkCreate({ ...VALID_BODY, prerequisiteIds });
      expect(fields).toEqual(["prerequisiteIds"]);
    }
  });

  it("accepts up to 20 prerequisites and rejects 21", async () => {
    expect((await checkCreate({ ...VALID_BODY, prerequisiteIds: ids(20) })).errors).toHaveLength(0);
    expect((await checkCreate({ ...VALID_BODY, prerequisiteIds: ids(21) })).fields).toEqual([
      "prerequisiteIds",
    ]);
  });

  it("reads an id in upper case as the same id as its lower case form", async () => {
    const upper = await checkCreate({ ...VALID_BODY, prerequisiteIds: [BASIC_ID.toUpperCase()] });
    expect(upper.errors).toHaveLength(0);
    expect(upper.dto.prerequisiteIds).toEqual([BASIC_ID]);

    const repeated = await checkCreate({
      ...VALID_BODY,
      prerequisiteIds: [BASIC_ID, BASIC_ID.toUpperCase()],
    });
    expect(repeated.fields).toEqual(["prerequisiteIds"]);
  });

  it("explains a missing name, description and category by what is missing", async () => {
    const { errors } = await checkCreate({});

    expect(messagesOf(errors)).toEqual(
      [
        "name should not be empty",
        "description should not be empty",
        "category must be one of the following values: basic, intermediate, advanced",
      ].sort(),
    );
  });

  it("explains a value of the wrong kind by its kind, not by a length limit", async () => {
    const { errors } = await checkCreate({
      name: 12,
      description: 7,
      objective: 5,
      category: "expert",
      prerequisiteIds: "not-a-list",
    });

    expect(messagesOf(errors)).toEqual(
      [
        "name must be a string",
        "description must be a string",
        "objective must be a string",
        "category must be one of the following values: basic, intermediate, advanced",
        "prerequisiteIds must be an array",
      ].sort(),
    );
  });

  it("reports every invalid field at once", async () => {
    const { fields } = await checkCreate({
      name: "",
      description: "",
      category: "expert",
      prerequisiteIds: ["nope"],
    });

    expect(fields).toEqual(["category", "description", "name", "prerequisiteIds"]);
  });

  it("drops the fields the client has no say in", async () => {
    const { dto, errors } = await checkCreate({
      ...VALID_BODY,
      id: BASIC_ID,
      status: "archived",
      createdById: INTERMEDIATE_ID,
      archivedAt: "2026-01-01T00:00:00.000Z",
      archivedById: INTERMEDIATE_ID,
      archiveReason: "injected",
    });

    expect(errors).toHaveLength(0);
    for (const field of [
      "id",
      "status",
      "createdById",
      "archivedAt",
      "archivedById",
      "archiveReason",
    ]) {
      expect(dto).not.toHaveProperty(field);
    }
  });
});

describe("UpdateCourseDto", () => {
  it("accepts an empty body and a partial body", async () => {
    const empty = await checkUpdate({});
    expect(empty.errors).toHaveLength(0);
    expect(empty.dto.name).toBeUndefined();
    expect(empty.dto.prerequisiteIds).toBeUndefined();

    const { dto, errors } = await checkUpdate({ category: "advanced", name: "  Novo  " });
    expect(errors).toHaveLength(0);
    expect(dto.category).toBe(CourseCategory.ADVANCED);
    expect(dto.name).toBe("Novo");
    expect(dto.description).toBeUndefined();
  });

  it("rejects null for name, description, category and prerequisiteIds", async () => {
    const { fields } = await checkUpdate({
      name: null,
      description: null,
      category: null,
      prerequisiteIds: null,
    });

    expect(fields).toEqual(["category", "description", "name", "prerequisiteIds"]);
  });

  it("applies the same rules as the create body to the fields sent", async () => {
    expect((await checkUpdate({ name: "   " })).fields).toEqual(["name"]);
    expect((await checkUpdate({ name: "a".repeat(201) })).fields).toEqual(["name"]);
    expect((await checkUpdate({ description: "" })).fields).toEqual(["description"]);
    expect((await checkUpdate({ description: "a".repeat(2001) })).fields).toEqual(["description"]);
    expect((await checkUpdate({ category: "expert" })).fields).toEqual(["category"]);
    expect((await checkUpdate({ objective: "a".repeat(2001) })).fields).toEqual(["objective"]);
    expect((await checkUpdate({ prerequisiteIds: ["nope"] })).fields).toEqual(["prerequisiteIds"]);
    expect((await checkUpdate({ prerequisiteIds: [BASIC_ID, BASIC_ID] })).fields).toEqual([
      "prerequisiteIds",
    ]);
    expect((await checkUpdate({ prerequisiteIds: ids(21) })).fields).toEqual(["prerequisiteIds"]);
    expect((await checkUpdate({ prerequisiteIds: ids(20) })).errors).toHaveLength(0);
  });

  it("accepts [] to clear the prerequisites and reads ids in lower case", async () => {
    const cleared = await checkUpdate({ prerequisiteIds: [] });
    expect(cleared.errors).toHaveLength(0);
    expect(cleared.dto.prerequisiteIds).toEqual([]);

    const upper = await checkUpdate({ prerequisiteIds: [INTERMEDIATE_ID.toUpperCase()] });
    expect(upper.errors).toHaveLength(0);
    expect(upper.dto.prerequisiteIds).toEqual([INTERMEDIATE_ID]);
  });

  it("accepts null to clear the objective, and a blank string means the same", async () => {
    const nothing = await checkUpdate({ objective: null });
    expect(nothing.errors).toHaveLength(0);
    expect(nothing.dto.objective).toBeNull();

    const blank = await checkUpdate({ objective: "  " });
    expect(blank.errors).toHaveLength(0);
    expect(blank.dto.objective).toBeNull();
  });

  it("explains a value of the wrong kind by its kind", async () => {
    const { errors } = await checkUpdate({
      name: 12,
      description: 7,
      category: "expert",
      prerequisiteIds: "not-a-list",
    });

    expect(messagesOf(errors)).toEqual(
      [
        "name must be a string",
        "description must be a string",
        "category must be one of the following values: basic, intermediate, advanced",
        "prerequisiteIds must be an array",
      ].sort(),
    );
  });
});
