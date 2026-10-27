import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate, ValidationError } from "class-validator";
import { flattenValidationErrors } from "@shared/filters/http-exception.filter";
import { ReplaceCourseLessonPlansDto } from "../dto/replace-course-lesson-plans.dto";

const FIRST_ID = "01999a3e-7c1b-7000-8000-000000000001";
const SECOND_ID = "01999a3e-7c1b-7000-8000-000000000002";
const THIRD_ID = "01999a3e-7c1b-7000-8000-000000000003";

function fieldsOf(errors: ValidationError[]): string[] {
  return errors.map((error) => error.property).sort();
}

function messagesOf(errors: ValidationError[]): string[] {
  return flattenValidationErrors(errors).map((error) => error.message);
}

function ids(total: number): string[] {
  return Array.from(
    { length: total },
    (_, index) => `01999a3e-7c1b-7000-8000-${String(index).padStart(12, "0")}`,
  );
}

async function check(body: Record<string, unknown>) {
  const dto = plainToInstance(ReplaceCourseLessonPlansDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: fieldsOf(errors) };
}

describe("ReplaceCourseLessonPlansDto", () => {
  it("accepts three uuids and an empty list", async () => {
    const three = await check({ lessonPlanIds: [FIRST_ID, SECOND_ID, THIRD_ID] });
    expect(three.errors).toHaveLength(0);
    expect(three.dto.lessonPlanIds).toEqual([FIRST_ID, SECOND_ID, THIRD_ID]);

    const empty = await check({ lessonPlanIds: [] });
    expect(empty.errors).toHaveLength(0);
    expect(empty.dto.lessonPlanIds).toEqual([]);
  });

  it("keeps the order it received", async () => {
    const { dto, errors } = await check({ lessonPlanIds: [THIRD_ID, FIRST_ID, SECOND_ID] });

    expect(errors).toHaveLength(0);
    expect(dto.lessonPlanIds).toEqual([THIRD_ID, FIRST_ID, SECOND_ID]);
  });

  it("lower-cases every id", async () => {
    const { dto, errors } = await check({
      lessonPlanIds: [FIRST_ID.toUpperCase(), SECOND_ID, THIRD_ID.toUpperCase()],
    });

    expect(errors).toHaveLength(0);
    expect(dto.lessonPlanIds).toEqual([FIRST_ID, SECOND_ID, THIRD_ID]);
  });

  it("keeps a repeated id for the service to refuse (no @ArrayUnique)", async () => {
    // A repeated plan is DUPLICATE_LESSON_PLAN, answered by CourseLessonPlansService; @ArrayUnique
    // would turn it into VALIDATION_FAILED, the only code the global pipe emits.
    const repeated = await check({ lessonPlanIds: [FIRST_ID, FIRST_ID] });
    expect(repeated.errors).toHaveLength(0);
    expect(repeated.dto.lessonPlanIds).toEqual([FIRST_ID, FIRST_ID]);

    // After lower-casing, the same id in upper case is the same id as well: the service sees both.
    const upper = await check({ lessonPlanIds: [FIRST_ID, FIRST_ID.toUpperCase()] });
    expect(upper.errors).toHaveLength(0);
    expect(upper.dto.lessonPlanIds).toEqual([FIRST_ID, FIRST_ID]);
  });

  it("reports field lessonPlanIds when it is missing, null, not a list, has a non-uuid or has more than 100 ids", async () => {
    for (const body of [
      {},
      { lessonPlanIds: null },
      { lessonPlanIds: "not-a-list" },
      { lessonPlanIds: FIRST_ID },
      { lessonPlanIds: { 0: FIRST_ID } },
      { lessonPlanIds: ["not-a-uuid"] },
      { lessonPlanIds: [FIRST_ID, "nope"] },
      { lessonPlanIds: [FIRST_ID, 7] },
      { lessonPlanIds: [FIRST_ID, null] },
      { lessonPlanIds: [FIRST_ID, ""] },
      { lessonPlanIds: ids(101) },
    ]) {
      const { fields } = await check(body);
      expect(fields).toEqual(["lessonPlanIds"]);
    }
  });

  it("accepts up to 100 lesson plans and rejects 101", async () => {
    expect((await check({ lessonPlanIds: ids(100) })).errors).toHaveLength(0);
    expect((await check({ lessonPlanIds: ids(101) })).fields).toEqual(["lessonPlanIds"]);
  });

  it("explains a missing list, a non-uuid and an excess of ids by what is wrong", async () => {
    expect(messagesOf((await check({})).errors)).toEqual(["lessonPlanIds must be an array"]);
    expect(messagesOf((await check({ lessonPlanIds: ["nope"] })).errors)).toEqual([
      "each value in lessonPlanIds must be a UUID",
    ]);
    expect(messagesOf((await check({ lessonPlanIds: ids(101) })).errors)).toEqual([
      "lessonPlanIds must contain no more than 100 elements",
    ]);
  });

  it("drops the fields the client has no say in", async () => {
    const { dto, errors } = await check({
      lessonPlanIds: [FIRST_ID],
      courseId: SECOND_ID,
      plannedWorkloadMinutes: 9999,
      items: [],
    });

    expect(errors).toHaveLength(0);
    for (const field of ["courseId", "plannedWorkloadMinutes", "items"]) {
      expect(dto).not.toHaveProperty(field);
    }
  });
});
