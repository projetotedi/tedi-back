import { RosterEnrollment } from "@modules/classes/services/enrollment-roster.service";
import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";
import { AbsenceJustificationResponseDto } from "../dto/absence-justification.response.dto";
import { AttendanceCorrectionResponseDto } from "../dto/attendance-correction.response.dto";
import { StudentAttendanceResponseDto } from "../dto/student-attendance.response.dto";
import { StudentRollCallItemResponseDto } from "../dto/student-roll-call-item.response.dto";
import { AttendanceCorrection } from "../entities/attendance-correction.entity";
import { StudentAttendance } from "../entities/student-attendance.entity";

/**
 * Whether the caller sees the free text of the attendance (the justification and the reasons of the
 * corrections, which may be health data, RNF-13). It is the decision of the policy for the lesson,
 * made once per request, and it has no default on purpose: every caller decides.
 */
export interface NotesVisibility {
  canSeeNotes: boolean;
}

const NAME_COLLATOR = new Intl.Collator("pt-BR", { sensitivity: "base" });

/** The id and the name of a person, or null when she is not among the people read (removed). */
function personRefOf(
  peopleById: ReadonlyMap<string, PersonRefDto>,
  personId: string,
): PersonRefDto | null {
  const person = peopleById.get(personId);
  return person === undefined ? null : { id: person.id, name: person.name };
}

/**
 * The justification of the row, or null when it has none. Reason, who and when come together (the
 * CHECK of the table), so a reason without the instant is a broken database and throws.
 */
function justificationOf(
  row: StudentAttendance,
  peopleById: ReadonlyMap<string, PersonRefDto>,
): AbsenceJustificationResponseDto | null {
  if (row.justificationReason === null) return null;
  if (row.justifiedById === null || row.justifiedAt === null) {
    throw new Error(`The justification of the attendance ${row.id} has no author or instant.`);
  }
  return {
    reason: row.justificationReason,
    note: row.justificationNote,
    justifiedBy: personRefOf(peopleById, row.justifiedById),
    justifiedAt: row.justifiedAt,
  };
}

function toCorrectionResponse(
  correction: AttendanceCorrection,
  peopleById: ReadonlyMap<string, PersonRefDto>,
  { canSeeNotes }: NotesVisibility,
): AttendanceCorrectionResponseDto {
  return {
    id: correction.id,
    fromStatus: correction.fromStatus,
    toStatus: correction.toStatus,
    reason: canSeeNotes ? correction.reason : null,
    correctedBy: personRefOf(peopleById, correction.correctedById),
    correctedAt: correction.createdAt,
  };
}

/**
 * The attendance of a student at a lesson, field by field. `corrections` are the ones of this row,
 * the oldest first. The justification and the reasons of the corrections go out only when
 * `canSeeNotes`; `justified` always does, so the list never says "not justified" by hiding it.
 */
export function toStudentAttendanceResponse(
  row: StudentAttendance,
  corrections: readonly AttendanceCorrection[],
  peopleById: ReadonlyMap<string, PersonRefDto>,
  visibility: NotesVisibility,
): StudentAttendanceResponseDto {
  return {
    id: row.id,
    lessonId: row.lessonId,
    enrollmentId: row.enrollmentId,
    status: row.status,
    signedBy: personRefOf(peopleById, row.signedById),
    signedAt: row.signedAt,
    justified: row.justificationReason !== null,
    justification: visibility.canSeeNotes ? justificationOf(row, peopleById) : null,
    corrections: corrections.map((correction) =>
      toCorrectionResponse(correction, peopleById, visibility),
    ),
  };
}

/**
 * One student of the roll call: the enrollment (id, status and since when, nothing else), the
 * student (id and name, nothing else: no phone, accessibility or age) and the attendance, null while
 * not signed. `correctionsByRow` holds the corrections of the lesson by attendance.
 */
export function toStudentRollCallItem(
  enrollment: RosterEnrollment,
  row: StudentAttendance | null,
  correctionsByRow: ReadonlyMap<string, readonly AttendanceCorrection[]>,
  peopleById: ReadonlyMap<string, PersonRefDto>,
  visibility: NotesVisibility,
): StudentRollCallItemResponseDto {
  return {
    enrollment: {
      id: enrollment.id,
      status: enrollment.status,
      statusChangedAt: enrollment.statusChangedAt,
    },
    student: personRefOf(peopleById, enrollment.studentId),
    attendance:
      row === null
        ? null
        : toStudentAttendanceResponse(
            row,
            correctionsByRow.get(row.id) ?? [],
            peopleById,
            visibility,
          ),
  };
}

/**
 * The order of a roll call (S20): the name of the student (pt-BR, ignoring case and accents), then
 * her id, then the id of the enrollment, which closes the tie; a removed person last, by the id of
 * the enrollment.
 */
export function compareRollCallItems(
  left: StudentRollCallItemResponseDto,
  right: StudentRollCallItemResponseDto,
): number {
  const byEnrollment = left.enrollment.id.localeCompare(right.enrollment.id);
  if (left.student === null && right.student === null) return byEnrollment;
  if (left.student === null) return 1;
  if (right.student === null) return -1;

  return (
    NAME_COLLATOR.compare(left.student.name, right.student.name) ||
    left.student.id.localeCompare(right.student.id) ||
    byEnrollment
  );
}
