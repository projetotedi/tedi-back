import { ageOn } from "@shared/dates/calendar-date";
import { StudentResponseDto } from "../dto/student.response.dto";
import { Person } from "../entities/person.entity";
import { StudentProfile } from "../entities/student-profile.entity";

/**
 * Builds the API shape of a student from its Person and StudentProfile.
 * Explicit projection: nothing from the entities reaches the response by accident.
 *
 * `today` is the "YYYY-MM-DD" date in America/Sao_Paulo, computed once by the caller
 * so a batch of students is aged against the same day.
 */
export function toStudentResponse(
  person: Person,
  profile: StudentProfile,
  today: string,
): StudentResponseDto {
  if (person.birthDate === null) {
    // Invariant guard: create requires the date and update rejects null.
    throw new Error(`Student ${person.id} has no birthDate`);
  }

  return {
    id: person.id,
    name: person.name,
    birthDate: person.birthDate,
    age: ageOn(person.birthDate, today),
    email: person.email,
    phone: person.phone,
    education: profile.education,
    hasSmartphone: profile.hasSmartphone,
    hasComputer: profile.hasComputer,
    howFoundUs: profile.howFoundUs,
    emergencyContactName: profile.emergencyContactName,
    emergencyContactPhone: profile.emergencyContactPhone,
    accessibilityNeed: profile.accessibilityNeed,
    supportResource: profile.supportResource,
    classNeeds: profile.classNeeds,
    archivedAt: profile.archive?.archivedAt ?? null,
    archivedById: profile.archive?.archivedById ?? null,
    archiveReason: profile.archive?.archiveReason ?? null,
    createdById: profile.createdById,
    createdAt: profile.createdAt,
    updatedAt: person.updatedAt > profile.updatedAt ? person.updatedAt : profile.updatedAt,
  };
}
