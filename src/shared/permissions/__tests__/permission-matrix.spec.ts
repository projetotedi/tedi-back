import { Role } from "@shared/enums/role.enum";
import { Permission } from "../permission.enum";
import {
  MATRIX_ROLES,
  PERMISSION_MATRIX,
  buildPermissionMap,
  scopeFor,
} from "../permission-matrix";
import { SCOPES, Scope } from "../scope.type";

// Transcribed from the validated matrix in the GUS-114 card, independently of the implementation.
// [permission, member, director, coordinator]
const EXPECTED: [Permission, Scope, Scope, Scope][] = [
  [Permission.ACCOUNT_MANAGE_OWN, "own", "own", "own"],
  [Permission.MEMBERS_LIST, "none", "all", "all"],
  [Permission.MEMBERS_VIEW, "none", "department", "all"],
  [Permission.MEMBERS_EDIT, "none", "department", "all"],
  [Permission.MEMBERS_DEACTIVATE, "none", "none", "all"],
  [Permission.ASSIGNMENTS_CREATE, "none", "all", "all"],
  [Permission.INVITES_MANAGE, "none", "none", "all"],
  [Permission.ACCESS_MANAGE, "none", "none", "all"],
  [Permission.CATALOG_VIEW, "all", "all", "all"],
  [Permission.LESSON_PLANS_MANAGE, "none", "all", "all"],
  [Permission.COURSES_MANAGE, "none", "all", "all"],
  [Permission.COURSES_DUPLICATE_ARCHIVE, "none", "all", "all"],
  [Permission.CLASSES_VIEW, "all", "all", "all"],
  [Permission.CLASSES_MANAGE, "none", "all", "all"],
  [Permission.ENROLLMENTS_MANAGE, "none", "all", "all"],
  [Permission.LESSONS_VIEW, "all", "all", "all"],
  [Permission.ASSIGNMENTS_MANAGE_OWN, "own", "own", "own"],
  [Permission.LESSONS_MANAGE, "none", "all", "all"],
  [Permission.ASSIGNMENTS_REVIEW, "none", "all", "all"],
  [Permission.ATTENDANCE_TAKE_STUDENTS, "allocated", "all", "all"],
  [Permission.ATTENDANCE_CONFIRM_MEMBER, "lessonTeacher", "all", "all"],
  [Permission.ATTENDANCE_CORRECT, "none", "all", "all"],
  [Permission.STUDENTS_VIEW, "all", "all", "all"],
  [Permission.STUDENTS_MANAGE, "none", "all", "all"],
  [Permission.STUDENTS_ARCHIVE, "none", "none", "all"],
  [Permission.HOURS_VIEW_OTHERS, "none", "department", "all"],
  [Permission.HOURS_LOG_FOR_OTHERS, "none", "department", "all"],
  [Permission.HOURS_REVIEW, "none", "none", "all"],
  [Permission.HOURS_EXPORT, "none", "department", "all"],
];

describe("PERMISSION_MATRIX", () => {
  it.each(EXPECTED)("%s → member %s, director %s, coordinator %s", (permission, m, d, c) => {
    expect(scopeFor(Role.MEMBER, permission)).toBe(m);
    expect(scopeFor(Role.DIRECTOR, permission)).toBe(d);
    expect(scopeFor(Role.COORDINATOR, permission)).toBe(c);
  });

  it("defines a scope for every Permission and every product role", () => {
    expect(Object.keys(PERMISSION_MATRIX).sort()).toEqual(Object.values(Permission).sort());

    for (const permission of Object.values(Permission)) {
      const row = PERMISSION_MATRIX[permission];
      expect(Object.keys(row).sort()).toEqual([...MATRIX_ROLES].sort());
      for (const role of MATRIX_ROLES) {
        expect(SCOPES).toContain(row[role]);
      }
    }
  });

  it("EXPECTED covers every Permission exactly once", () => {
    const listed = EXPECTED.map(([permission]) => permission);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(Object.values(Permission).sort());
  });

  it("superadmin gets all for every permission", () => {
    for (const permission of Object.values(Permission)) {
      expect(scopeFor(Role.SUPERADMIN, permission)).toBe("all");
    }
  });

  it("buildPermissionMap returns one entry per Permission with the role's scopes", () => {
    for (const role of Object.values(Role)) {
      const map = buildPermissionMap(role);
      expect(Object.keys(map)).toEqual(Object.values(Permission));
      for (const permission of Object.values(Permission)) {
        expect(map[permission]).toBe(scopeFor(role, permission));
      }
    }
  });
});
