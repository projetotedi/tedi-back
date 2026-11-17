import "reflect-metadata";
import { ClassConstructor, plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { flattenValidationErrors } from "@shared/filters/http-exception.filter";
import { STUDENT_ATTENDANCE_MAX_ENTRIES } from "../dto/attendance-limits";
import { SignStudentAttendanceDto } from "../dto/sign-student-attendance.dto";
import { StudentAttendanceStatus } from "../enums/student-attendance-status.enum";

const ENROLLMENT_ID = "01999a3e-7c1b-7000-8000-000000000e01";

async function check<T extends object>(target: ClassConstructor<T>, body: Record<string, unknown>) {
  const dto = plainToInstance(target, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: flattenValidationErrors(errors).map((error) => error.field) };
}

function entries(count: number): Array<{ enrollmentId: string; status: string }> {
  return Array.from({ length: count }, (_, index) => ({
    enrollmentId: `01999a3e-7c1b-7000-8000-${String(index).padStart(12, "0")}`,
    status: index % 2 === 0 ? "present" : "absent",
  }));
}

describe("the bodies of the roll call of the students", () => {
  it("accepts 1 to 100 entries with a uuid and present or absent, and refuses an empty list, 101 entries, a bad uuid and an unknown status", async () => {
    for (const count of [1, STUDENT_ATTENDANCE_MAX_ENTRIES]) {
      expect((await check(SignStudentAttendanceDto, { entries: entries(count) })).errors).toEqual(
        [],
      );
    }
    const { dto } = await check(SignStudentAttendanceDto, {
      entries: [{ enrollmentId: ENROLLMENT_ID.toUpperCase(), status: "absent" }],
      lessonId: "x",
    });
    expect(dto.entries[0]).toEqual({
      enrollmentId: ENROLLMENT_ID.toUpperCase(),
      status: StudentAttendanceStatus.ABSENT,
    });
    expect(dto).not.toHaveProperty("lessonId");

    expect((await check(SignStudentAttendanceDto, { entries: [] })).fields).toEqual(["entries"]);
    expect((await check(SignStudentAttendanceDto, {})).fields).toEqual(["entries"]);
    expect(
      (
        await check(SignStudentAttendanceDto, {
          entries: entries(STUDENT_ATTENDANCE_MAX_ENTRIES + 1),
        })
      ).fields,
    ).toEqual(["entries"]);
    expect(
      (
        await check(SignStudentAttendanceDto, {
          entries: [
            { enrollmentId: ENROLLMENT_ID, status: "present" },
            { enrollmentId: "not-a-uuid", status: "late" },
          ],
        })
      ).fields.sort(),
    ).toEqual(["entries.1.enrollmentId", "entries.1.status"]);
  });

  it("does not refuse a repeated enrollment: the service answers DUPLICATE_ENROLLMENT with the positions", async () => {
    const { errors } = await check(SignStudentAttendanceDto, {
      entries: [
        { enrollmentId: ENROLLMENT_ID, status: "present" },
        { enrollmentId: ENROLLMENT_ID, status: "present" },
      ],
    });

    expect(errors).toEqual([]);
  });
});
