import { ageOn } from "@shared/dates/calendar-date";
import { StudentResponseDto } from "../dto/student.response.dto";
import { Person } from "../entities/person.entity";
import { StudentProfile } from "../entities/student-profile.entity";
import { AccessibilityNeed } from "../enums/accessibility-need.enum";
import type { StudentListEntry } from "./students.service";

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

/** One row of `StudentsService.listStudentEntries`, as the query reads it (the birth date as text). */
export interface StudentListEntryRow {
  id: string;
  name: string;
  birthDate: string | null;
  phone: string | null;
  accessibilityNeed: AccessibilityNeed;
}

/**
 * The student of a list for another module (`StudentListEntry`). Explicit projection, aged against
 * `today` ("YYYY-MM-DD" in America/Sao_Paulo, computed once per page by the caller).
 */
export function toStudentListEntry(row: StudentListEntryRow, today: string): StudentListEntry {
  if (row.birthDate === null) {
    // Invariant guard, as in toStudentResponse: create requires the date and update rejects null.
    throw new Error(`Student ${row.id} has no birthDate`);
  }

  return {
    id: row.id,
    name: row.name,
    age: ageOn(row.birthDate, today),
    phone: row.phone,
    accessibilityNeed: row.accessibilityNeed,
  };
}
