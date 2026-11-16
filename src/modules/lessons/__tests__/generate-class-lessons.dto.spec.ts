import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate, ValidationError } from "class-validator";
import { flattenValidationErrors } from "@shared/filters/http-exception.filter";
import { GenerateClassLessonsDto } from "../dto/generate-class-lessons.dto";
import { Weekday } from "../enums/weekday.enum";

/** The body of the modal of the Figma: toda terça, das 9h às 11h, a partir de 07/04. */
const VALID_BODY = {
  weekday: "tuesday",
  startTime: "09:00",
  endTime: "11:00",
  firstDate: "2026-04-07",
  location: "Laboratório 2 — Bloco B",
};

function fieldsOf(errors: ValidationError[]): string[] {
  return errors.map((error) => error.property).sort();
}

async function check(body: Record<string, unknown>) {
  const dto = plainToInstance(GenerateClassLessonsDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: fieldsOf(errors) };
}

describe("GenerateClassLessonsDto", () => {
  it("accepts the body of the Figma", async () => {
    const { dto, errors } = await check(VALID_BODY);

    expect(errors).toHaveLength(0);
    expect(dto.weekday).toBe(Weekday.TUESDAY);
    expect(dto.startTime).toBe("09:00");
    expect(dto.endTime).toBe("11:00");
    expect(dto.firstDate).toBe("2026-04-07");
    expect(dto.location).toBe("Laboratório 2 — Bloco B");
  });

  it("accepts the four fields alone: the place is optional", async () => {
    const { location: _location, ...withoutLocation } = VALID_BODY;

    const { dto, errors } = await check(withoutLocation);

    expect(errors).toHaveLength(0);
    expect(dto.location).toBeUndefined();
  });

  it("requires weekday, startTime, endTime and firstDate", async () => {
    expect((await check({})).fields).toEqual(["endTime", "firstDate", "startTime", "weekday"]);
    expect((await check({ weekday: "tuesday", firstDate: "2026-04-07" })).fields).toEqual([
      "endTime",
      "startTime",
    ]);
  });

  describe("weekday", () => {
    it.each(Object.values(Weekday))("accepts %s", async (weekday) => {
      expect((await check({ ...VALID_BODY, weekday })).errors).toHaveLength(0);
    });

    it("rejects weekday outside the enum (terça, Tuesday, 2)", async () => {
      for (const weekday of ["terça", "Tuesday", "TUESDAY", " tuesday", "2", 2, "", null, true]) {
        const { fields, errors } = await check({ ...VALID_BODY, weekday });

        expect(fields).toEqual(["weekday"]);
        // The message lists the values, so the front can show what is accepted.
        expect(JSON.stringify(flattenValidationErrors(errors))).toContain("monday");
      }
    });
  });

  describe("firstDate", () => {
    it("rejects firstDate 2026-02-30 and 07/04/2026", async () => {
      for (const firstDate of [
        "2026-02-30",
        "07/04/2026",
        "2026-4-7",
        "2026-04-07T00:00:00Z",
        "0000-01-01",
        "",
        null,
        20260407,
      ]) {
        expect((await check({ ...VALID_BODY, firstDate })).fields).toEqual(["firstDate"]);
      }
    });

    it("accepts the leap day and the ends of the year", async () => {
      for (const firstDate of ["2028-02-29", "2026-12-31", "2027-01-01"]) {
        expect((await check({ ...VALID_BODY, firstDate })).errors).toHaveLength(0);
      }
      // 2026 is not a leap year.
      expect((await check({ ...VALID_BODY, firstDate: "2026-02-29" })).fields).toEqual([
        "firstDate",
      ]);
    });

    it("does not look at the day of the week: the service moves it to the weekday", async () => {
      // 2026-04-06 is a monday and the weekday is tuesday: still a valid body.
      expect((await check({ ...VALID_BODY, firstDate: "2026-04-06" })).errors).toHaveLength(0);
    });
  });

  describe("startTime and endTime", () => {
    it("rejects 9:00 and 24:00", async () => {
      for (const time of ["9:00", "24:00", "14:00:00", "14h00", "12:60", "", null, 900]) {
        expect((await check({ ...VALID_BODY, startTime: time })).fields).toEqual(["startTime"]);
        expect((await check({ ...VALID_BODY, endTime: time })).fields).toEqual(["endTime"]);
      }
    });

    it("accepts the ends of the day", async () => {
      expect(
        (await check({ ...VALID_BODY, startTime: "00:00", endTime: "23:59" })).errors,
      ).toHaveLength(0);
    });

    it("does not compare the two: an end before the start is INVALID_TIME_RANGE, answered by the service", async () => {
      const { errors } = await check({ ...VALID_BODY, startTime: "11:00", endTime: "09:00" });

      expect(errors).toHaveLength(0);
    });
  });

  describe("location", () => {
    it("trims location and turns blank into null", async () => {
      const trimmed = await check({ ...VALID_BODY, location: "  Laboratório 2  " });
      expect(trimmed.errors).toHaveLength(0);
      expect(trimmed.dto.location).toBe("Laboratório 2");

      for (const blank of ["", " ", "   "]) {
        const { dto, errors } = await check({ ...VALID_BODY, location: blank });

        expect(errors).toHaveLength(0);
        expect(dto.location).toBeNull();
      }
    });

    it("takes null as not informed", async () => {
      const { dto, errors } = await check({ ...VALID_BODY, location: null });

      expect(errors).toHaveLength(0);
      expect(dto.location).toBeNull();
    });

    it("rejects location over 200", async () => {
      expect((await check({ ...VALID_BODY, location: "l".repeat(200) })).errors).toHaveLength(0);
      expect((await check({ ...VALID_BODY, location: "l".repeat(201) })).fields).toEqual([
        "location",
      ]);
      // The limit is on the trimmed text.
      expect(
        (await check({ ...VALID_BODY, location: `  ${"l".repeat(200)}  ` })).errors,
      ).toHaveLength(0);
    });

    it("rejects a place that is not text", async () => {
      for (const location of [123, true, ["a"], {}]) {
        expect((await check({ ...VALID_BODY, location })).fields).toEqual(["location"]);
      }
    });
  });

  it("drops the fields the client has no say in: the lessons come from the plans of the course", async () => {
    const { dto, errors } = await check({
      ...VALID_BODY,
      classId: "01999a3e-7c1b-7000-8000-0000000000c1",
      title: "Outro título",
      objective: "Outro objetivo",
      expectedStudents: 15,
      expectedMonitors: 2,
      subject: "Assunto",
      status: "confirmed",
      sequenceOrder: 3,
      lessonPlanId: "01999a3e-7c1b-7000-8000-000000000011",
    });

    expect(errors).toHaveLength(0);
    for (const field of [
      "classId",
      "title",
      "objective",
      "expectedStudents",
      "expectedMonitors",
      "subject",
      "status",
      "sequenceOrder",
      "lessonPlanId",
    ]) {
      expect(dto).not.toHaveProperty(field);
    }
    expect(Object.keys(dto).sort()).toEqual([
      "endTime",
      "firstDate",
      "location",
      "startTime",
      "weekday",
    ]);
  });
});
