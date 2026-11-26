import { DepartmentResponseDto } from "../dto/department.response.dto";
import { MemberRegistrationListItemDto } from "../dto/member-registration-list-item.dto";
import { MemberRegistrationResponseDto } from "../dto/member-registration.response.dto";
import { Department } from "../entities/department.entity";
import { MemberProfile } from "../entities/member-profile.entity";
import { Person } from "../entities/person.entity";

/** Explicit projection of a department: only id and name reach the response. */
export function toDepartmentResponse(department: Department): DepartmentResponseDto {
  return { id: department.id, name: department.name };
}

/**
 * Row of the validation queue. Explicit projection: no CPF, address, phone nor e-mails.
 * Nothing from the entities reaches the response by accident.
 */
export function toMemberRegistrationListItem(
  person: Person,
  profile: MemberProfile,
  department: Department | null,
): MemberRegistrationListItemDto {
  return {
    id: person.id,
    name: person.name,
    ra: person.ra,
    requestedRole: profile.requestedRole,
    department: department === null ? null : toDepartmentResponse(department),
    course: profile.course,
    className: profile.className,
    semester: profile.semester,
    registrationStatus: profile.registrationStatus,
    submittedAt: profile.submittedAt,
    reviewedAt: profile.reviewedAt,
  };
}

/**
 * The registration in full, for coordination only: it carries the full CPF (RNF-14).
 * `personalEmail` is Person.email; `updatedAt` is the most recent change between the person
 * and the profile.
 */
export function toMemberRegistrationResponse(
  person: Person,
  profile: MemberProfile,
  department: Department | null,
): MemberRegistrationResponseDto {
  return {
    id: person.id,
    name: person.name,
    ra: person.ra,
    personalEmail: person.email,
    phone: person.phone,
    birthDate: person.birthDate,
    cpf: profile.cpf,
    address: profile.address,
    city: profile.city,
    state: profile.state,
    institutionalEmail: profile.institutionalEmail,
    course: profile.course,
    semester: profile.semester,
    className: profile.className,
    volunteerTermUrl: profile.volunteerTermUrl,
    department: department === null ? null : toDepartmentResponse(department),
    requestedRole: profile.requestedRole,
    role: person.role,
    accessEnabled: person.accessEnabled,
    registrationStatus: profile.registrationStatus,
    mainFunction: profile.mainFunction,
    joinedAt: profile.joinedAt,
    submittedAt: profile.submittedAt,
    reviewedAt: profile.reviewedAt,
    reviewedById: profile.reviewedById,
    reviewNote: profile.reviewNote,
    createdAt: profile.createdAt,
    updatedAt: person.updatedAt > profile.updatedAt ? person.updatedAt : profile.updatedAt,
  };
}
