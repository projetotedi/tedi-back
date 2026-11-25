import "reflect-metadata";
import {
  EnrollmentStatus,
  RosterEnrollment,
} from "@modules/classes/services/enrollment-roster.service";
import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";
import { StudentRollCallItemResponseDto } from "../dto/student-roll-call-item.response.dto";
import { AttendanceCorrection } from "../entities/attendance-correction.entity";
import { StudentAttendance } from "../entities/student-attendance.entity";
import { AbsenceJustificationReason } from "../enums/absence-justification-reason.enum";
import { StudentAttendanceStatus } from "../enums/student-attendance-status.enum";
import {
  compareRollCallItems,
  toStudentAttendanceResponse,
  toStudentRollCallItem,
} from "../services/student-attendance-response.mapper";

const LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
const ENROLLMENT_ID = "01999a3e-7c1b-7000-8000-000000000e01";
const ROW_ID = "01999a3e-7c1b-7000-8000-000000000a01";
const SIGNED_AT = new Date("2026-03-10T14:05:00.000Z");
const JUSTIFIED_AT = new Date("2026-03-10T14:20:00.000Z");

const MARIA = { id: "01999a3e-0000-7000-8000-000000000001", name: "Maria Aparecida" };
const BEATRIZ = { id: "01999a3e-0000-7000-8000-000000000002", name: "Beatriz Nunes" };
const COORDINATION = { id: "01999a3e-0000-7000-8000-000000000003", name: "Carla Menezes" };

const PEOPLE: ReadonlyMap<string, PersonRefDto> = new Map(
  [MARIA, BEATRIZ, COORDINATION].map((person) => [person.id, person]),
);

function enrollmentOf(overrides: Partial<RosterEnrollment> = {}): RosterEnrollment {
  return {
    id: ENROLLMENT_ID,
    studentId: MARIA.id,
    status: EnrollmentStatus.ACTIVE,
    statusChangedAt: "2026-03-03",
    ...overrides,
  };
}

function rowOf(overrides: Partial<StudentAttendance> = {}): StudentAttendance {
  return Object.assign(new StudentAttendance(), {
    id: ROW_ID,
    lessonId: LESSON_ID,
    enrollmentId: ENROLLMENT_ID,
    status: StudentAttendanceStatus.ABSENT,
    signedById: BEATRIZ.id,
    signedAt: SIGNED_AT,
    justificationReason: AbsenceJustificationReason.HEALTH,
    justificationNote: "Consulta médica marcada.",
    justifiedById: BEATRIZ.id,
    justifiedAt: JUSTIFIED_AT,
    createdAt: SIGNED_AT,
    updatedAt: JUSTIFIED_AT,
    deletedAt: null,
    ...overrides,
  });
}

function correctionOf(id: string, createdAt: Date): AttendanceCorrection {
  return Object.assign(new AttendanceCorrection(), {
    id,
    studentAttendanceId: ROW_ID,
    fromStatus: StudentAttendanceStatus.PRESENT,
    toStatus: StudentAttendanceStatus.ABSENT,
    reason: "Saiu antes por causa da saúde.",
    correctedById: COORDINATION.id,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  });
}

const OLD = correctionOf("01999a3e-7c1b-7000-8000-000000000c01", new Date("2026-03-10T15:00:00Z"));
const NEW = correctionOf("01999a3e-7c1b-7000-8000-000000000c02", new Date("2026-03-10T16:00:00Z"));

function itemOf(name: string | null, enrollmentId: string, studentId = MARIA.id) {
  const item: StudentRollCallItemResponseDto = {
    enrollment: {
      id: enrollmentId,
      status: EnrollmentStatus.ACTIVE,
      statusChangedAt: "2026-03-03",
    },
    student: name === null ? null : { id: studentId, name },
    attendance: null,
  };
  return item;
}

describe("student attendance response mapper", () => {
  it("maps a signed absence with its justification and corrections, oldest first", () => {
    const response = toStudentAttendanceResponse(rowOf(), [OLD, NEW], PEOPLE, {
      canSeeNotes: true,
    });

    expect(response).toEqual({
      id: ROW_ID,
      lessonId: LESSON_ID,
      enrollmentId: ENROLLMENT_ID,
      status: StudentAttendanceStatus.ABSENT,
      signedBy: BEATRIZ,
      signedAt: SIGNED_AT,
      justified: true,
      justification: {
        reason: AbsenceJustificationReason.HEALTH,
        note: "Consulta médica marcada.",
        justifiedBy: BEATRIZ,
        justifiedAt: JUSTIFIED_AT,
      },
      corrections: [
        {
          id: OLD.id,
          fromStatus: StudentAttendanceStatus.PRESENT,
          toStatus: StudentAttendanceStatus.ABSENT,
          reason: "Saiu antes por causa da saúde.",
          correctedBy: COORDINATION,
          correctedAt: OLD.createdAt,
        },
        expect.objectContaining({ id: NEW.id, correctedAt: NEW.createdAt }),
      ],
    });
  });

  it("hides the justification and the reasons of the corrections when the caller cannot see notes, keeping justified", () => {
    const response = toStudentAttendanceResponse(rowOf(), [OLD], PEOPLE, { canSeeNotes: false });

    expect(response.justified).toBe(true);
    expect(response.justification).toBeNull();
    expect(response.corrections).toEqual([
      expect.objectContaining({ id: OLD.id, reason: null, correctedBy: COORDINATION }),
    ]);
  });

  it("answers justified false and justification null for an absence without a justification, and a removed person as null", () => {
    const response = toStudentAttendanceResponse(
      rowOf({
        justificationReason: null,
        justificationNote: null,
        justifiedById: null,
        justifiedAt: null,
        signedById: "01999a3e-0000-7000-8000-0000000000ff",
      }),
      [],
      PEOPLE,
      { canSeeNotes: true },
    );

    expect(response.justified).toBe(false);
    expect(response.justification).toBeNull();
    expect(response.signedBy).toBeNull();
    expect(response.corrections).toEqual([]);
  });

  it("throws for a justification without its author or instant, a broken database", () => {
    expect(() =>
      toStudentAttendanceResponse(rowOf({ justifiedAt: null }), [], PEOPLE, { canSeeNotes: true }),
    ).toThrow("has no author or instant");
  });

  it("answers attendance null for an enrollment without a signature", () => {
    const item = toStudentRollCallItem(enrollmentOf(), null, new Map(), PEOPLE, {
      canSeeNotes: true,
    });

    expect(item).toEqual({
      enrollment: {
        id: ENROLLMENT_ID,
        status: EnrollmentStatus.ACTIVE,
        statusChangedAt: "2026-03-03",
      },
      student: MARIA,
      attendance: null,
    });
  });

  it("answers only id and name of a person, and only id, status and statusChangedAt of an enrollment", () => {
    const richPeople = new Map(
      [MARIA, BEATRIZ, COORDINATION].map((person) => [
        person.id,
        { ...person, phone: "43999990000", age: 68, accessibilityNeed: "visual" },
      ]),
    );

    const item = toStudentRollCallItem(
      enrollmentOf({ status: EnrollmentStatus.DROPPED, statusChangedAt: "2026-03-12" }),
      rowOf(),
      new Map([[ROW_ID, [OLD]]]),
      richPeople,
      { canSeeNotes: true },
    );

    expect(Object.keys(item).sort()).toEqual(["attendance", "enrollment", "student"]);
    expect(item.enrollment).toEqual({
      id: ENROLLMENT_ID,
      status: EnrollmentStatus.DROPPED,
      statusChangedAt: "2026-03-12",
    });
    expect(item.student).toEqual(MARIA);
    expect(item.attendance?.signedBy).toEqual(BEATRIZ);
    expect(item.attendance?.justification?.justifiedBy).toEqual(BEATRIZ);
    expect(item.attendance?.corrections[0].correctedBy).toEqual(COORDINATION);
  });

  it("orders by the name of the student ignoring case and accents, then by id, then by enrollment, a removed person last", () => {
    const items = [
      itemOf(null, "e-9"),
      itemOf("Álvaro", "e-3", "s-2"),
      itemOf("bruno", "e-1"),
      itemOf(null, "e-5"),
      itemOf("Alvaro", "e-2", "s-1"),
      itemOf("Alvaro", "e-1", "s-1"),
    ];

    expect(
      [...items]
        .sort(compareRollCallItems)
        .map((item) => [item.student?.name ?? null, item.enrollment.id]),
    ).toEqual([
      ["Alvaro", "e-1"],
      ["Alvaro", "e-2"],
      ["Álvaro", "e-3"],
      ["bruno", "e-1"],
      [null, "e-5"],
      [null, "e-9"],
    ]);
  });
});
