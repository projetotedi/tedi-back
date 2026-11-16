import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate, ValidationError } from "class-validator";
import { EnrollStudentsDto } from "../dto/enroll-students.dto";
import { ENROLLMENT_MAX_STUDENTS } from "../dto/enrollment-limits";
import { ListAvailableStudentsQueryDto } from "../dto/list-available-students-query.dto";
import { ListClassEnrollmentsQueryDto } from "../dto/list-class-enrollments-query.dto";
import { ListStudentsByEnrollmentQueryDto } from "../dto/list-students-by-enrollment-query.dto";
import { UpdateEnrollmentStatusDto } from "../dto/update-enrollment-status.dto";
import { EnrollmentStatus } from "../enums/enrollment-status.enum";
import { StudentEnrollmentSituation } from "../enums/student-enrollment-situation.enum";

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

  it("accepts page, limit, search and one status in the class list; classId and situation in the list by enrollment", async () => {
    const list = await check(ListClassEnrollmentsQueryDto, {
      page: "2",
      limit: "50",
      search: "Ana",
      status: "dropped",
    });
    expect(list.fields).toEqual([]);
    expect(list.dto).toMatchObject({
      page: 2,
      limit: 50,
      search: "Ana",
      status: EnrollmentStatus.DROPPED,
    });
    expect((await check(ListClassEnrollmentsQueryDto, {})).fields).toEqual([]);
    expect(
      (await check(ListClassEnrollmentsQueryDto, { page: "0", limit: "101", status: "paused" }))
        .fields,
    ).toEqual(["limit", "page", "status"]);
    expect(
      (await check(ListAvailableStudentsQueryDto, { search: "a".repeat(101) })).fields,
    ).toEqual(["search"]);

    const byEnrollment = await check(ListStudentsByEnrollmentQueryDto, {
      classId: "01999A3E-7C1B-7000-8000-0000000000C1",
      situation: "not_enrolled",
      page: "1",
    });
    expect(byEnrollment.fields).toEqual([]);
    expect(byEnrollment.dto.situation).toBe(StudentEnrollmentSituation.NOT_ENROLLED);
    expect((await check(ListStudentsByEnrollmentQueryDto, {})).fields).toEqual([]);
  });

  it("keeps page and limit undefined when they come as undefined, with no validation error", async () => {
    for (const target of [ListClassEnrollmentsQueryDto, ListStudentsByEnrollmentQueryDto]) {
      const dto = plainToInstance(target, { page: undefined, limit: undefined });

      expect(dto.page).toBeUndefined();
      expect(dto.limit).toBeUndefined();
      await expect(validate(dto, { whitelist: true })).resolves.toEqual([]);
    }
  });

  it("refuses a classId that is not a uuid and an unknown situation", async () => {
    expect(
      (await check(ListStudentsByEnrollmentQueryDto, { classId: "not-a-uuid", situation: "all" }))
        .fields,
    ).toEqual(["classId", "situation"]);
  });
});
