/**
 * Why a student missed a lesson, the select "Motivo" of the justification (GUS-166, S9). The list is
 * the minimum on purpose: the design shows only "Saúde", and `other` with the note covers the rest.
 * Postgres cannot drop a label of an enum without recreating the type, while adding one is cheap: a
 * reason the PO asks for later is a migration with
 * `ALTER TYPE student_attendance_justification_reason_enum ADD VALUE` and a value here.
 *
 * The value is health data in itself (RNF-13): it never goes to an audit event.
 */
export enum AbsenceJustificationReason {
  HEALTH = "health",
  OTHER = "other",
}

/**
 * The description of AbsenceJustificationReason, the same on every property that names it: swagger
 * keeps the description of the first property that names an enum as the description of the enum
 * itself.
 */
export const ABSENCE_JUSTIFICATION_REASON_DESCRIPTION =
  "Why the student missed the lesson: health or other (the note says more). The front translates by the value.";
