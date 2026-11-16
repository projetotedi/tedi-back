import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate, ValidationError } from "class-validator";
import { EnrollStudentsDto } from "../dto/enroll-students.dto";
import { ENROLLMENT_MAX_STUDENTS } from "../dto/enrollment-limits";
import { UpdateEnrollmentStatusDto } from "../dto/update-enrollment-status.dto";
import { EnrollmentStatus } from "../enums/enrollment-status.enum";

function fieldsOf(errors: ValidationError[]): string[] {
  return errors.map((error) => error.property).sort();
}

async function check<T extends object>(target: new () => T, plain: Record<string, unknown>) {
  const dto = plainToInstance(target, plain);
  const errors = await validate(dto, { whitelist: true });
  return { dto, fields: fieldsOf(errors) };
}

/** `count` distinct, well formed ids. */
function ids(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `01999a3e-7c1b-7000-8000-${String(index).padStart(12, "0")}`,
  );
}

describe("enrollment DTOs", () => {
  it("accepts 1 to 100 uuids and refuses an empty list, 101 ids and a value that is not a uuid", async () => {
    expect((await check(EnrollStudentsDto, { studentIds: ids(1) })).fields).toEqual([]);
    expect(
      (await check(EnrollStudentsDto, { studentIds: ids(ENROLLMENT_MAX_STUDENTS) })).fields,
    ).toEqual([]);
    // A repeated id passes here: the service answers it with DUPLICATE_STUDENT and the positions.
    const repeated = ids(1);
    expect(
      (await check(EnrollStudentsDto, { studentIds: [repeated[0], repeated[0].toUpperCase()] }))
        .fields,
    ).toEqual([]);

    for (const studentIds of [[], ids(ENROLLMENT_MAX_STUDENTS + 1), ["not-a-uuid"], "a", null]) {
      expect((await check(EnrollStudentsDto, { studentIds })).fields).toEqual(["studentIds"]);
    }
    expect((await check(EnrollStudentsDto, {})).fields).toEqual(["studentIds"]);
  });

  it("requires status and effectiveDate, refuses a date that does not exist, trims the reason to null and refuses more than 500 characters", async () => {
    const ok = await check(UpdateEnrollmentStatusDto, {
      status: EnrollmentStatus.DROPPED,
      effectiveDate: "2026-04-10",
      reason: "  Mudou de cidade.  ",
    });
    expect(ok.fields).toEqual([]);
    expect(ok.dto.reason).toBe("Mudou de cidade.");

    expect((await check(UpdateEnrollmentStatusDto, {})).fields).toEqual([
      "effectiveDate",
      "status",
    ]);
    expect(
      (
        await check(UpdateEnrollmentStatusDto, {
          status: "paused",
          effectiveDate: "2026-02-30",
        })
      ).fields,
    ).toEqual(["effectiveDate", "status"]);

    const blank = await check(UpdateEnrollmentStatusDto, {
      status: EnrollmentStatus.ACTIVE,
      effectiveDate: "2026-04-10",
      reason: "   ",
    });
    expect(blank.fields).toEqual([]);
    expect(blank.dto.reason).toBeNull();

    expect(
      (
        await check(UpdateEnrollmentStatusDto, {
          status: EnrollmentStatus.COMPLETED,
          effectiveDate: "2026-04-10",
          reason: "r".repeat(501),
        })
      ).fields,
    ).toEqual(["reason"]);
    expect(
      (
        await check(UpdateEnrollmentStatusDto, {
          status: EnrollmentStatus.COMPLETED,
          effectiveDate: "2026-04-10",
          reason: "r".repeat(500),
        })
      ).fields,
    ).toEqual([]);
  });
});
