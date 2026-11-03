import { Role } from "@shared/enums/role.enum";
import { MyProfileResponseDto } from "../dto/my-profile.response.dto";
import { Department } from "../entities/department.entity";
import { MemberProfile } from "../entities/member-profile.entity";
import { Person } from "../entities/person.entity";
import { maskCpf } from "../validators/cpf";
import { toDepartmentResponse } from "./member-registration.mapper";

/** A Person with an access profile: the only kind that logs in, so the only one that has a profile page. */
export type PersonWithRole = Person & { role: Role };

/**
 * "Meu perfil" (GUS-122) from the Person, her MemberProfile (null for the seeded admin,
 * coordinators and any account created before GUS-91) and the department of that profile.
 * Explicit projection: nothing from the entities reaches the response by accident.
 *
 *  - `cpfMasked` is the only way the CPF leaves here (RNF-14); the full CPF has no key at all.
 *  - `personalEmail` is Person.email (ARCHITECTURE section 11.1) and only exists together with
 *    a member profile, so a person without one gets null there while `email` keeps the value.
 *  - `lastLoginAt` is the login BEFORE the current one (`previousLoginAt`): read after the login
 *    of the current session, `lastLoginAt` of the Person would be the login that just happened.
 */
export function toMyProfileResponse(
  person: PersonWithRole,
  profile: MemberProfile | null,
  department: Department | null,
): MyProfileResponseDto {
  return {
    name: person.name,
    ra: person.ra,
    role: person.role,
    accessEnabled: person.accessEnabled,
    birthDate: person.birthDate,
    phone: person.phone,
    email: person.email,
    personalEmail: profile === null ? null : person.email,
    address: profile?.address ?? null,
    city: profile?.city ?? null,
    state: profile?.state ?? null,
    institutionalEmail: profile?.institutionalEmail ?? null,
    course: profile?.course ?? null,
    semester: profile?.semester ?? null,
    className: profile?.className ?? null,
    volunteerTermUrl: profile?.volunteerTermUrl ?? null,
    mainFunction: profile?.mainFunction ?? null,
    department: department === null ? null : toDepartmentResponse(department),
    joinedAt: profile?.joinedAt ?? null,
    cpfMasked: maskCpf(profile?.cpf ?? null),
    lastLoginAt: person.previousLoginAt,
  };
}
