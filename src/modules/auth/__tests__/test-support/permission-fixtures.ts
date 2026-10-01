import { AuthUser } from "@shared/decorators/auth-user.type";

/**
 * Fake domain facts used by the permissions e2e (GUS-114).
 * The real departments (GUS-91) and lesson staff (lessons module) do not exist yet:
 * the e2e fills these maps and the demo controller reads them, the way a domain
 * service will later load them before calling PermissionPolicy.
 */

/** personId → department ids. */
export const FAKE_DEPARTMENTS = new Map<string, string[]>();

/** lessonId → staff allocated to the lesson. */
export const FAKE_LESSON_STAFF = new Map<string, { teacherIds: string[]; monitorIds: string[] }>();

/** Simulates what the AuthGuard will do from GUS-91 on: attach the actor's departments. */
export function withFakeDepartments(user: AuthUser): AuthUser {
  return { ...user, departmentIds: FAKE_DEPARTMENTS.get(user.id) ?? [] };
}
