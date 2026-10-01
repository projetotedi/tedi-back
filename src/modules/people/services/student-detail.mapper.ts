import { StudentDetailDto } from "../dto/student-detail.response.dto";
import { Person } from "../entities/person.entity";
import { StudentProfile } from "../entities/student-profile.entity";
import { toStudentResponse } from "./student-response.mapper";

/**
 * Builds the student record page (GUS-107) from its Person, StudentProfile and the Person who
 * registered it. Explicit projection: no entity field reaches the response by accident.
 * `creator` is null when that Person was soft-deleted (createdBy: null).
 * If the coordination restricts the sensitive fields (RNF-13), the cut belongs here.
 *
 * `today` is the "YYYY-MM-DD" date in America/Sao_Paulo, computed once by the caller.
 */
export function toStudentDetail(
  person: Person,
  profile: StudentProfile,
  creator: Person | null,
  today: string,
): StudentDetailDto {
  // Age, the birthDate guard and the latest updatedAt live in one place: the GUS-105 mapper.
  const student = toStudentResponse(person, profile, today);

  return {
    id: student.id,
    name: student.name,
    birthDate: student.birthDate,
    age: student.age,
    phone: student.phone,
    email: student.email,
    education: student.education,
    hasSmartphone: student.hasSmartphone,
    hasComputer: student.hasComputer,
    howFoundUs: student.howFoundUs,
    emergencyContact: { name: student.emergencyContactName, phone: student.emergencyContactPhone },
    accessibilityNeed: student.accessibilityNeed,
    supportResource: student.supportResource,
    classNeeds: student.classNeeds,
    createdAt: student.createdAt,
    createdBy: creator ? { id: creator.id, name: creator.name } : null,
    updatedAt: student.updatedAt,
    archivedAt: student.archivedAt,
    archiveReason: student.archiveReason,
  };
}
