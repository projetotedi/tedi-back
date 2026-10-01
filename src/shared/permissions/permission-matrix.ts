import { Role } from "@shared/enums/role.enum";
import { Permission } from "./permission.enum";
import { Scope } from "./scope.type";

/** Product roles that have a column in the matrix. SUPERADMIN is technical and gets "all". */
export type MatrixRole = Exclude<Role, Role.SUPERADMIN>;

export const MATRIX_ROLES: readonly MatrixRole[] = [Role.MEMBER, Role.DIRECTOR, Role.COORDINATOR];

const M = Role.MEMBER;
const D = Role.DIRECTOR;
const C = Role.COORDINATOR;

function row(member: Scope, director: Scope, coordinator: Scope): Record<MatrixRole, Scope> {
  return { [M]: member, [D]: director, [C]: coordinator };
}

/**
 * Single source of truth: who can do what, and within which scope.
 * docs/PERMISSIONS.md is generated from this object (yarn permissions:export).
 */
export const PERMISSION_MATRIX: Readonly<Record<Permission, Readonly<Record<MatrixRole, Scope>>>> =
  {
    // Account
    [Permission.ACCOUNT_MANAGE_OWN]: row("own", "own", "own"),
    // Members and access
    [Permission.MEMBERS_LIST]: row("none", "all", "all"),
    [Permission.MEMBERS_VIEW]: row("none", "department", "all"),
    [Permission.MEMBERS_EDIT]: row("none", "department", "all"),
    [Permission.MEMBERS_DEACTIVATE]: row("none", "none", "all"),
    [Permission.ASSIGNMENTS_CREATE]: row("none", "all", "all"),
    [Permission.INVITES_MANAGE]: row("none", "none", "all"),
    [Permission.ACCESS_MANAGE]: row("none", "none", "all"),
    // Catalog
    [Permission.CATALOG_VIEW]: row("all", "all", "all"),
    [Permission.LESSON_PLANS_MANAGE]: row("none", "all", "all"),
    [Permission.COURSES_MANAGE]: row("none", "all", "all"),
    [Permission.COURSES_DUPLICATE_ARCHIVE]: row("none", "all", "all"),
    // Classes and enrollments
    [Permission.CLASSES_VIEW]: row("all", "all", "all"),
    [Permission.CLASSES_MANAGE]: row("none", "all", "all"),
    [Permission.ENROLLMENTS_MANAGE]: row("none", "all", "all"),
    // Lessons
    [Permission.LESSONS_VIEW]: row("all", "all", "all"),
    [Permission.ASSIGNMENTS_MANAGE_OWN]: row("own", "own", "own"),
    [Permission.LESSONS_MANAGE]: row("none", "all", "all"),
    [Permission.ASSIGNMENTS_REVIEW]: row("none", "all", "all"),
    // Attendance
    [Permission.ATTENDANCE_TAKE_STUDENTS]: row("allocated", "all", "all"),
    [Permission.ATTENDANCE_CONFIRM_MEMBER]: row("lessonTeacher", "all", "all"),
    [Permission.ATTENDANCE_CORRECT]: row("none", "all", "all"),
    // Students
    [Permission.STUDENTS_VIEW]: row("all", "all", "all"),
    [Permission.STUDENTS_MANAGE]: row("none", "all", "all"),
    [Permission.STUDENTS_DELETE]: row("none", "none", "all"),
    // Hours
    [Permission.HOURS_VIEW_OTHERS]: row("none", "department", "all"),
    [Permission.HOURS_LOG_FOR_OTHERS]: row("none", "department", "all"),
    [Permission.HOURS_REVIEW]: row("none", "none", "all"),
    [Permission.HOURS_EXPORT]: row("none", "department", "all"),
  };

/**
 * Scope of `permission` for `role`.
 * SUPERADMIN gets "all" everywhere (the self-attendance rule lives in the policy).
 */
export function scopeFor(role: Role, permission: Permission): Scope {
  if (role === Role.SUPERADMIN) return "all";
  return PERMISSION_MATRIX[permission][role];
}

/** Full `{ [permission]: scope }` map for the role, in enum order. */
export function buildPermissionMap(role: Role): Record<Permission, Scope> {
  const map = {} as Record<Permission, Scope>;
  for (const permission of Object.values(Permission)) {
    map[permission] = scopeFor(role, permission);
  }
  return map;
}
