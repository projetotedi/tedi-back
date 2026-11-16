import { ConfirmedAssignment } from "@modules/assignments/services/confirmed-staff.service";
import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";
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
