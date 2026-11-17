import "reflect-metadata";
import { ClassConstructor, plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { flattenValidationErrors } from "@shared/filters/http-exception.filter";
import {
  ABSENCE_JUSTIFICATION_NOTE_MAX_LENGTH,
  ATTENDANCE_CORRECTION_REASON_MAX_LENGTH,
  STUDENT_ATTENDANCE_MAX_ENTRIES,
} from "../dto/attendance-limits";
import { CorrectStudentAttendanceDto } from "../dto/correct-student-attendance.dto";
import { JustifyAbsenceDto } from "../dto/justify-absence.dto";
import { SignStudentAttendanceDto } from "../dto/sign-student-attendance.dto";
import { AbsenceJustificationReason } from "../enums/absence-justification-reason.enum";
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

  it("requires a known reason to justify, trims the note to null and refuses more than 500 characters", async () => {
    const full = await check(JustifyAbsenceDto, { reason: "health", note: "  Consulta médica.  " });
    expect(full.errors).toEqual([]);
    expect(full.dto).toEqual({
      reason: AbsenceJustificationReason.HEALTH,
      note: "Consulta médica.",
    });

    for (const note of ["", "   ", null]) {
      const blank = await check(JustifyAbsenceDto, { reason: "other", note });
      expect(blank.errors).toEqual([]);
      expect(blank.dto.note).toBeNull();
    }
    expect((await check(JustifyAbsenceDto, { reason: "other" })).errors).toEqual([]);
    expect(
      (
        await check(JustifyAbsenceDto, {
          reason: "health",
          note: "x".repeat(ABSENCE_JUSTIFICATION_NOTE_MAX_LENGTH),
        })
      ).errors,
    ).toEqual([]);

    expect((await check(JustifyAbsenceDto, {})).fields).toEqual(["reason"]);
    expect((await check(JustifyAbsenceDto, { reason: "travel" })).fields).toEqual(["reason"]);
    expect(
      (
        await check(JustifyAbsenceDto, {
          reason: "health",
          note: "x".repeat(ABSENCE_JUSTIFICATION_NOTE_MAX_LENGTH + 1),
        })
      ).fields,
    ).toEqual(["note"]);
    expect((await check(JustifyAbsenceDto, { reason: "health", note: 42 })).fields).toEqual([
      "note",
    ]);
  });

  it("requires status and a reason to correct: missing, empty or blank after trim is VALIDATION_FAILED; refuses more than 500", async () => {
    const valid = await check(CorrectStudentAttendanceDto, {
      status: "absent",
      reason: "  Marcado por engano.  ",
    });
    expect(valid.errors).toEqual([]);
    expect(valid.dto).toEqual({
      status: StudentAttendanceStatus.ABSENT,
      reason: "Marcado por engano.",
    });

    for (const body of [
      { status: "present" },
      { status: "present", reason: "" },
      { status: "present", reason: "   " },
      { status: "present", reason: null },
      { status: "present", reason: "x".repeat(ATTENDANCE_CORRECTION_REASON_MAX_LENGTH + 1) },
    ]) {
      expect((await check(CorrectStudentAttendanceDto, body)).fields).toEqual(["reason"]);
    }
    expect(
      (
        await check(CorrectStudentAttendanceDto, {
          status: "present",
          reason: "x".repeat(ATTENDANCE_CORRECTION_REASON_MAX_LENGTH),
        })
      ).errors,
    ).toEqual([]);
    expect((await check(CorrectStudentAttendanceDto, { reason: "Engano." })).fields).toEqual([
      "status",
    ]);
    expect(
      (await check(CorrectStudentAttendanceDto, { status: "late", reason: "Engano." })).fields,
    ).toEqual(["status"]);
  });
});
