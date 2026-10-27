import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate, ValidationError } from "class-validator";
import { flattenValidationErrors } from "@shared/filters/http-exception.filter";
import { CreateClassDto } from "../dto/create-class.dto";
import { UpdateClassDto } from "../dto/update-class.dto";
import { ClassStatus } from "../enums/class-status.enum";

const COURSE_ID = "01999a3e-7c1b-7000-8000-000000000001";
const PERSON_ID = "01999a3e-0000-7000-8000-0000000000aa";

const VALID_BODY = {
  courseId: COURSE_ID,
  code: "INFO-A",
  editionName: "2026.1",
  startDate: "2026-03-03",
  endDate: "2026-06-27",
  capacity: 15,
};

function fieldsOf(errors: ValidationError[]): string[] {
  return errors.map((error) => error.property).sort();
}

function messagesOf(errors: ValidationError[]): string[] {
  return flattenValidationErrors(errors)
    .map((error) => error.message)
    .sort();
}

async function checkCreate(body: Record<string, unknown>) {
  const dto = plainToInstance(CreateClassDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: fieldsOf(errors) };
}

async function checkUpdate(body: Record<string, unknown>) {
  const dto = plainToInstance(UpdateClassDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: fieldsOf(errors) };
}

describe("CreateClassDto", () => {
  it("accepts INFO-A in 2026.1, from 2026-03-03 to 2026-06-27, with 15 seats and nothing else", async () => {
    const { dto, errors } = await checkCreate(VALID_BODY);

    expect(errors).toHaveLength(0);
    expect(dto.courseId).toBe(COURSE_ID);
    expect(dto.code).toBe("INFO-A");
    expect(dto.editionName).toBe("2026.1");
    expect(dto.startDate).toBe("2026-03-03");
    expect(dto.endDate).toBe("2026-06-27");
    expect(dto.capacity).toBe(15);
    expect(dto.location).toBeUndefined();
    expect(dto.name).toBeUndefined();
    expect(dto.status).toBeUndefined();
  });

  it("accepts every optional field", async () => {
    const { dto, errors } = await checkCreate({
      ...VALID_BODY,
      location: "Laboratório 3, bloco B",
      name: "Informática Básica, turma A",
      status: "in_progress",
    });

    expect(errors).toHaveLength(0);
    expect(dto.location).toBe("Laboratório 3, bloco B");
    expect(dto.name).toBe("Informática Básica, turma A");
    expect(dto.status).toBe(ClassStatus.IN_PROGRESS);
  });

  describe("editionName", () => {
    it("accepts a year and a term from 1 to 9", async () => {
      for (const editionName of ["2026.1", "2026.2", "2027.9", "1999.1"]) {
        const { dto, errors } = await checkCreate({ ...VALID_BODY, editionName });

        expect(errors).toHaveLength(0);
        expect(dto.editionName).toBe(editionName);
      }
    });

    it("rejects 2026, 2026.10, 26.1, 2026.0 and the other shapes that are not a year and a term", async () => {
      for (const editionName of [
        "2026",
        "2026.10",
        "26.1",
        "2026.0",
        "2026.01",
        "2026-1",
        "2026/1",
        "2026,1",
        "2026.1.1",
        "20261",
        "a026.1",
        "2026.a",
        "٢٠٢٦.١",
        "2026.1\n2026.2",
        " ",
        "",
      ]) {
        const { fields } = await checkCreate({ ...VALID_BODY, editionName });

        expect(fields).toEqual(["editionName"]);
      }
    });

    it("trims the spaces around it", async () => {
      const { dto, errors } = await checkCreate({ ...VALID_BODY, editionName: " 2026.1 " });

      expect(errors).toHaveLength(0);
      expect(dto.editionName).toBe("2026.1");
    });

    it("rejects a value that is not a string, null and a missing one", async () => {
      const { editionName: _editionName, ...withoutEdition } = VALID_BODY;

      expect((await checkCreate(withoutEdition)).fields).toEqual(["editionName"]);
      for (const editionName of [null, 2026.1, 2026, true, ["2026.1"], { name: "2026.1" }]) {
        expect((await checkCreate({ ...VALID_BODY, editionName })).fields).toEqual(["editionName"]);
      }
    });

    it("explains a value that is not a year and a term by what it expects", async () => {
      const { errors } = await checkCreate({ ...VALID_BODY, editionName: "2026" });

      expect(messagesOf(errors)).toEqual(["editionName must be a year and a term, like 2026.1"]);
    });
  });

  describe("courseId", () => {
    it("reads the id in lower case, so the answer repeats the one of the database", async () => {
      const { dto, errors } = await checkCreate({
        ...VALID_BODY,
        courseId: COURSE_ID.toUpperCase(),
      });

      expect(errors).toHaveLength(0);
      expect(dto.courseId).toBe(COURSE_ID);
    });

    it("rejects an id that is not a UUID, null and a missing one", async () => {
      const { courseId: _courseId, ...withoutCourse } = VALID_BODY;

      expect((await checkCreate(withoutCourse)).fields).toEqual(["courseId"]);
      for (const courseId of [
        "not-a-uuid",
        "",
        " ",
        null,
        12,
        true,
        [COURSE_ID],
        `${COURSE_ID}x`,
      ]) {
        expect((await checkCreate({ ...VALID_BODY, courseId })).fields).toEqual(["courseId"]);
      }
    });
  });

  describe("code", () => {
    it("trims it and accepts up to 30 characters", async () => {
      const trimmed = await checkCreate({ ...VALID_BODY, code: "  INFO-A  " });
      expect(trimmed.errors).toHaveLength(0);
      expect(trimmed.dto.code).toBe("INFO-A");

      expect((await checkCreate({ ...VALID_BODY, code: "c".repeat(30) })).errors).toHaveLength(0);
    });

    it("rejects an empty or blank code, one with 31 characters, a value that is not text and a missing one", async () => {
      const { code: _code, ...withoutCode } = VALID_BODY;

      expect((await checkCreate(withoutCode)).fields).toEqual(["code"]);
      for (const code of ["", "   ", "c".repeat(31), null, 12, true, ["INFO-A"]]) {
        expect((await checkCreate({ ...VALID_BODY, code })).fields).toEqual(["code"]);
      }
    });

    it("explains a missing code by what is missing and a value of the wrong kind by its kind", async () => {
      const { code: _code, ...withoutCode } = VALID_BODY;

      expect(messagesOf((await checkCreate(withoutCode)).errors)).toEqual([
        "code should not be empty",
      ]);
      expect(messagesOf((await checkCreate({ ...VALID_BODY, code: 12 })).errors)).toEqual([
        "code must be a string",
      ]);
    });
  });

  describe("startDate and endDate", () => {
    it("accepts the same day for both: a class of one day", async () => {
      const { errors } = await checkCreate({
        ...VALID_BODY,
        startDate: "2026-03-03",
        endDate: "2026-03-03",
      });

      expect(errors).toHaveLength(0);
    });

    it("does not compare the two dates: the period is checked by the service", async () => {
      const { errors } = await checkCreate({
        ...VALID_BODY,
        startDate: "2026-06-27",
        endDate: "2026-03-03",
      });

      expect(errors).toHaveLength(0);
    });

    it("rejects a day that does not exist, another format, a datetime, a number, null and a missing one", async () => {
      const { startDate: _startDate, ...withoutStart } = VALID_BODY;
      const { endDate: _endDate, ...withoutEnd } = VALID_BODY;

      expect((await checkCreate(withoutStart)).fields).toEqual(["startDate"]);
      expect((await checkCreate(withoutEnd)).fields).toEqual(["endDate"]);
      for (const value of [
        "2026-02-30",
        "2026-3-3",
        "03/03/2026",
        "2026-03-03T00:00:00Z",
        "20260303",
        "0000-01-01",
        "",
        null,
        20260303,
      ]) {
        expect((await checkCreate({ ...VALID_BODY, startDate: value })).fields).toEqual([
          "startDate",
        ]);
        expect((await checkCreate({ ...VALID_BODY, endDate: value })).fields).toEqual(["endDate"]);
      }
    });

    it("explains the error by the field and the format", async () => {
      const { errors } = await checkCreate({ ...VALID_BODY, startDate: "2026-02-30" });

      expect(messagesOf(errors)).toEqual(["startDate must be a date in YYYY-MM-DD format"]);
    });
  });

  describe("capacity", () => {
    it("accepts a whole number from 1 to 1000", async () => {
      for (const capacity of [1, 15, 1000]) {
        const { dto, errors } = await checkCreate({ ...VALID_BODY, capacity });

        expect(errors).toHaveLength(0);
        expect(dto.capacity).toBe(capacity);
      }
    });

    it("rejects 0, a negative number, 1.5, '15', 1001, null and a missing one", async () => {
      const { capacity: _capacity, ...withoutCapacity } = VALID_BODY;

      expect((await checkCreate(withoutCapacity)).fields).toEqual(["capacity"]);
      for (const capacity of [0, -1, 1.5, "15", 1001, 1e9, null, true, [15], Number.NaN]) {
        expect((await checkCreate({ ...VALID_BODY, capacity })).fields).toEqual(["capacity"]);
      }
    });
  });

  describe("status", () => {
    it("accepts each of the four statuses", async () => {
      for (const status of ["planned", "in_progress", "completed", "cancelled"]) {
        const { dto, errors } = await checkCreate({ ...VALID_BODY, status });

        expect(errors).toHaveLength(0);
        expect(dto.status).toBe(status);
      }
    });

    it("rejects a value outside the enum, in another case or of another kind", async () => {
      for (const status of ["open", "PLANNED", "Planned", "", " planned", 1, true, ["planned"]]) {
        expect((await checkCreate({ ...VALID_BODY, status })).fields).toEqual(["status"]);
      }
    });

    it("explains a status outside the enum by the values it takes", async () => {
      const { errors } = await checkCreate({ ...VALID_BODY, status: "open" });

      expect(messagesOf(errors)).toEqual([
        "status must be one of the following values: planned, in_progress, completed, cancelled",
      ]);
    });

    it("treats null like an omitted status: the service answers planned", async () => {
      const { dto, errors } = await checkCreate({ ...VALID_BODY, status: null });

      expect(errors).toHaveLength(0);
      expect(dto.status).toBeNull();
    });
  });

  describe("location and name", () => {
    it("trims them and treats a blank or null value as not informed", async () => {
      const trimmed = await checkCreate({
        ...VALID_BODY,
        location: "  Sala 2  ",
        name: "  Turma A  ",
      });
      expect(trimmed.errors).toHaveLength(0);
      expect(trimmed.dto.location).toBe("Sala 2");
      expect(trimmed.dto.name).toBe("Turma A");

      for (const value of ["", "   ", null]) {
        const { dto, errors } = await checkCreate({ ...VALID_BODY, location: value, name: value });

        expect(errors).toHaveLength(0);
        expect(dto.location).toBeNull();
        expect(dto.name).toBeNull();
      }
    });

    it("accepts up to 200 characters and rejects 201 or a value that is not text", async () => {
      expect(
        (await checkCreate({ ...VALID_BODY, location: "l".repeat(200), name: "n".repeat(200) }))
          .errors,
      ).toHaveLength(0);

      expect((await checkCreate({ ...VALID_BODY, location: "l".repeat(201) })).fields).toEqual([
        "location",
      ]);
      expect((await checkCreate({ ...VALID_BODY, name: "n".repeat(201) })).fields).toEqual([
        "name",
      ]);
      expect((await checkCreate({ ...VALID_BODY, location: 5 })).fields).toEqual(["location"]);
      expect((await checkCreate({ ...VALID_BODY, name: 5 })).fields).toEqual(["name"]);
    });
  });

  it("reports every invalid field at once", async () => {
    const { fields } = await checkCreate({
      courseId: "nope",
      code: "",
      editionName: "2026",
      startDate: "2026-02-30",
      endDate: "x",
      capacity: 0,
      status: "open",
      location: "l".repeat(201),
      name: "n".repeat(201),
    });

    expect(fields).toEqual([
      "capacity",
      "code",
      "courseId",
      "editionName",
      "endDate",
      "location",
      "name",
      "startDate",
      "status",
    ]);
  });

  it("explains a missing body field by what is missing", async () => {
    const { errors } = await checkCreate({});

    expect(messagesOf(errors)).toEqual(
      [
        "courseId must be a UUID",
        "code should not be empty",
        "editionName must be a string",
        "startDate must be a date in YYYY-MM-DD format",
        "endDate must be a date in YYYY-MM-DD format",
        "capacity must be an integer number",
      ].sort(),
    );
  });

  it("drops the fields the client has no say in", async () => {
    const { dto, errors } = await checkCreate({
      ...VALID_BODY,
      id: COURSE_ID,
      editionId: COURSE_ID,
      createdById: PERSON_ID,
      archivedAt: "2026-01-01T00:00:00.000Z",
      archivedById: PERSON_ID,
      archiveReason: "injected",
    });

    expect(errors).toHaveLength(0);
    for (const field of [
      "id",
      "editionId",
      "createdById",
      "archivedAt",
      "archivedById",
      "archiveReason",
    ]) {
      expect(dto).not.toHaveProperty(field);
    }
  });
});

describe("UpdateClassDto", () => {
  it("accepts an empty body and a partial body", async () => {
    const empty = await checkUpdate({});
    expect(empty.errors).toHaveLength(0);
    expect(empty.dto.code).toBeUndefined();
    expect(empty.dto.capacity).toBeUndefined();
    expect(empty.dto.status).toBeUndefined();

    const { dto, errors } = await checkUpdate({ capacity: 20, location: "  Sala 2  " });
    expect(errors).toHaveLength(0);
    expect(dto.capacity).toBe(20);
    expect(dto.location).toBe("Sala 2");
    expect(dto.code).toBeUndefined();
  });

  it("rejects null for code, editionName, startDate, endDate, capacity and status", async () => {
    const { fields } = await checkUpdate({
      code: null,
      editionName: null,
      startDate: null,
      endDate: null,
      capacity: null,
      status: null,
    });

    expect(fields).toEqual(["capacity", "code", "editionName", "endDate", "startDate", "status"]);
  });

  it("accepts null for location and name, and a blank string means the same: they clear", async () => {
    const nothing = await checkUpdate({ location: null, name: null });
    expect(nothing.errors).toHaveLength(0);
    expect(nothing.dto.location).toBeNull();
    expect(nothing.dto.name).toBeNull();

    const blank = await checkUpdate({ location: "   ", name: "" });
    expect(blank.errors).toHaveLength(0);
    expect(blank.dto.location).toBeNull();
    expect(blank.dto.name).toBeNull();
  });

  it("applies the same rules as the create body to the fields sent", async () => {
    expect((await checkUpdate({ code: "   " })).fields).toEqual(["code"]);
    expect((await checkUpdate({ code: "c".repeat(31) })).fields).toEqual(["code"]);
    expect((await checkUpdate({ code: "c".repeat(30) })).errors).toHaveLength(0);
    expect((await checkUpdate({ editionName: "2026" })).fields).toEqual(["editionName"]);
    expect((await checkUpdate({ editionName: "2026.10" })).fields).toEqual(["editionName"]);
    expect((await checkUpdate({ editionName: "2026.0" })).fields).toEqual(["editionName"]);
    expect((await checkUpdate({ startDate: "2026-02-30" })).fields).toEqual(["startDate"]);
    expect((await checkUpdate({ endDate: "03/03/2026" })).fields).toEqual(["endDate"]);
    expect((await checkUpdate({ capacity: 0 })).fields).toEqual(["capacity"]);
    expect((await checkUpdate({ capacity: 1.5 })).fields).toEqual(["capacity"]);
    expect((await checkUpdate({ capacity: "15" })).fields).toEqual(["capacity"]);
    expect((await checkUpdate({ capacity: 1001 })).fields).toEqual(["capacity"]);
    expect((await checkUpdate({ status: "open" })).fields).toEqual(["status"]);
    expect((await checkUpdate({ location: "l".repeat(201) })).fields).toEqual(["location"]);
    expect((await checkUpdate({ name: "n".repeat(201) })).fields).toEqual(["name"]);
  });

  it("trims the code and the edition name", async () => {
    const { dto, errors } = await checkUpdate({ code: "  INFO-B  ", editionName: " 2026.2 " });

    expect(errors).toHaveLength(0);
    expect(dto.code).toBe("INFO-B");
    expect(dto.editionName).toBe("2026.2");
  });

  it("accepts a status, a period and an edition name on their own", async () => {
    for (const body of [
      { status: "cancelled" },
      { startDate: "2026-03-10" },
      { endDate: "2026-07-04" },
      { startDate: "2026-06-27", endDate: "2026-03-03" },
      { editionName: "2026.2" },
    ]) {
      expect((await checkUpdate(body)).errors).toHaveLength(0);
    }
  });

  it("drops courseId: the course of a class never changes", async () => {
    const { dto, errors } = await checkUpdate({ courseId: COURSE_ID, capacity: 20 });

    expect(errors).toHaveLength(0);
    expect(dto).not.toHaveProperty("courseId");
    expect(dto.capacity).toBe(20);

    // Not even an invalid one is reported: the field does not exist for this body.
    expect((await checkUpdate({ courseId: "not-a-uuid" })).errors).toHaveLength(0);
  });

  it("drops the fields the client has no say in", async () => {
    const { dto, errors } = await checkUpdate({
      id: COURSE_ID,
      editionId: COURSE_ID,
      createdById: PERSON_ID,
      archivedAt: "2026-01-01T00:00:00.000Z",
      archivedById: PERSON_ID,
      archiveReason: "injected",
    });

    expect(errors).toHaveLength(0);
    for (const field of [
      "id",
      "editionId",
      "createdById",
      "archivedAt",
      "archivedById",
      "archiveReason",
    ]) {
      expect(dto).not.toHaveProperty(field);
    }
  });

  it("explains a value of the wrong kind by its kind", async () => {
    const { errors } = await checkUpdate({
      code: 12,
      editionName: 2026.1,
      startDate: 1,
      capacity: "15",
      status: "open",
    });

    expect(messagesOf(errors)).toEqual(
      [
        "code must be a string",
        "editionName must be a string",
        "startDate must be a date in YYYY-MM-DD format",
        "capacity must be an integer number",
        "status must be one of the following values: planned, in_progress, completed, cancelled",
      ].sort(),
    );
  });
});
