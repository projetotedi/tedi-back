import { MemberDetailResponseDto } from "../dto/member-detail.response.dto";
import { Department } from "../entities/department.entity";
import { MemberProfile } from "../entities/member-profile.entity";
import { Person } from "../entities/person.entity";
import { maskCpf } from "../validators/cpf";
import { toDepartmentResponse } from "./member-registration.mapper";

/**
 * Member record (GUS-144) from the Person, her MemberProfile (null for the seeded admin,
 * coordinators and any account created before GUS-91), the department of that profile and the
 * Person who reviewed the registration. Explicit projection: nothing from the entities reaches
 * the response by accident (no password hash, no requestedRole, no review note, no timestamps
 * of the registration other than `reviewedAt`).
 *
 *  - `cpfMasked` is the only way the CPF leaves here (RNF-14); the full CPF has no key at all.
 *  - `registrationStatus` null means "no member profile"; every other member field is null too.
 *  - `reviewedBy` is { id, name } of the reviewer; null when there is none (pending, approved by
 *    the backfill, or the reviewer was deleted).
 *
 * Phone and address are shown to every reader of the record, the director of the member's
 * department included (Q9.4, answered on 2026-11-11). This is the one place that decides what the
 * record shows.
 */
export function toMemberDetail(
  person: Person,
  profile: MemberProfile | null,
  department: Department | null,
  reviewer: Person | null,
): MemberDetailResponseDto {
  return {
    id: person.id,
    name: person.name,
    ra: person.ra,
    email: person.email,
    phone: person.phone,
    birthDate: person.birthDate,
    role: person.role,
    accessEnabled: person.accessEnabled,
    cpfMasked: maskCpf(profile?.cpf ?? null),
    address: profile?.address ?? null,
    city: profile?.city ?? null,
    state: profile?.state ?? null,
    institutionalEmail: profile?.institutionalEmail ?? null,
    course: profile?.course ?? null,
    semester: profile?.semester ?? null,
    className: profile?.className ?? null,
    department: department === null ? null : toDepartmentResponse(department),
    mainFunction: profile?.mainFunction ?? null,
    joinedAt: profile?.joinedAt ?? null,
    volunteerTermUrl: profile?.volunteerTermUrl ?? null,
    registrationStatus: profile?.registrationStatus ?? null,
    reviewedAt: profile?.reviewedAt ?? null,
    reviewedBy: reviewer === null ? null : { id: reviewer.id, name: reviewer.name },
  };
}
