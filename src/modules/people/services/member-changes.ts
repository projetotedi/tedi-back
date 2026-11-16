import { UpdateMemberDto } from "../dto/update-member.dto";
import { MemberProfile } from "../entities/member-profile.entity";
import { Person } from "../entities/person.entity";

/**
 * What an edit of a member changed. The raw values stay here: the audit event only gets the
 * allow-listed ones (member-audit.ts), and `fields` names every changed field.
 */
export interface MemberChanges {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  fields: string[];
}

export interface AppliedMemberEdit {
  changes: MemberChanges;
  personChanged: boolean;
  profileChanged: boolean;
}

/**
 * Applies PATCH /members/:id onto the Person and the MemberProfile of the member: each field that
 * was sent (not undefined) and differs from the stored value is copied, with its old and new
 * values. The body, the entities and the member record use the same names. Every field is applied:
 * the list is evaluated whole, never short-circuited, or a change after the first one would be
 * lost. The caller saves only the entity that changed.
 */
export function applyMemberEdit(
  person: Person,
  profile: MemberProfile,
  dto: UpdateMemberDto,
): AppliedMemberEdit {
  const changes: MemberChanges = { before: {}, after: {}, fields: [] };
  const personChanged = [
    applyChange(person, "name", dto.name, changes),
    applyChange(person, "ra", dto.ra, changes),
    applyChange(person, "email", dto.email, changes),
    applyChange(person, "birthDate", dto.birthDate, changes),
    applyChange(person, "phone", dto.phone, changes),
  ].includes(true);
  const profileChanged = [
    applyChange(profile, "cpf", dto.cpf, changes),
    applyChange(profile, "address", dto.address, changes),
    applyChange(profile, "city", dto.city, changes),
    applyChange(profile, "state", dto.state, changes),
    applyChange(profile, "institutionalEmail", dto.institutionalEmail, changes),
    applyChange(profile, "course", dto.course, changes),
    applyChange(profile, "semester", dto.semester, changes),
    applyChange(profile, "className", dto.className, changes),
    applyChange(profile, "departmentId", dto.departmentId, changes),
    applyChange(profile, "mainFunction", dto.mainFunction, changes),
    applyChange(profile, "joinedAt", dto.joinedAt, changes),
    applyChange(profile, "volunteerTermUrl", dto.volunteerTermUrl, changes),
  ].includes(true);
  return { changes, personChanged, profileChanged };
}

/** Copies `next` into `entity[field]` when it was sent and differs, recording the change. */
function applyChange<T extends object, K extends keyof T & string>(
  entity: T,
  field: K,
  next: T[K] | undefined,
  changes: MemberChanges,
): boolean {
  if (next === undefined || next === entity[field]) return false;
  changes.before[field] = entity[field];
  changes.after[field] = next;
  changes.fields.push(field);
  entity[field] = next;
  return true;
}
