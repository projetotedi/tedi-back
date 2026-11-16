import { ConfirmedAssignment } from "@modules/assignments/services/confirmed-staff.service";
import { LessonSummary } from "@modules/lessons/services/lessons.service";
import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";
import { MemberAttendanceHistoryItemResponseDto } from "../dto/member-attendance-history-item.response.dto";
import { MemberAttendanceResponseDto } from "../dto/member-attendance.response.dto";
import { MemberAttendance } from "../entities/member-attendance.entity";

/** The id and the name of a person, or null when she is not among the people read (removed). */
function personRefOf(
  peopleById: ReadonlyMap<string, PersonRefDto>,
  personId: string,
): PersonRefDto | null {
  const person = peopleById.get(personId);
  return person === undefined ? null : { id: person.id, name: person.name };
}

/**
 * A confirmed assignment of a lesson with the attendance of its member, field by field: `row` is
 * the attendance of the PERSON in the lesson (null while not signed), whatever assignment signed it.
 */
export function toMemberAttendanceResponse(
  assignment: ConfirmedAssignment,
  row: MemberAttendance | null,
  peopleById: ReadonlyMap<string, PersonRefDto>,
): MemberAttendanceResponseDto {
  return {
    assignmentId: assignment.id,
    person: personRefOf(peopleById, assignment.personId),
    role: assignment.role,
    status: row === null ? null : row.status,
    confirmedBy: row === null ? null : personRefOf(peopleById, row.confirmedById),
    confirmedAt: row === null ? null : row.confirmedAt,
    hourEntryId: row === null ? null : row.hourEntryId,
  };
}

/**
 * An item of the history of a member: the lesson (what says which one it is and when), the status
 * and when it was signed. Nothing of the class, of who signed or of the hours.
 */
export function toMemberAttendanceHistoryItem(
  row: MemberAttendance,
  lesson: LessonSummary,
): MemberAttendanceHistoryItemResponseDto {
  return {
    lesson: {
      id: lesson.id,
      title: lesson.title,
      date: lesson.date,
      startTime: lesson.startTime,
      endTime: lesson.endTime,
    },
    status: row.status,
    confirmedAt: row.confirmedAt,
  };
}
