import { ForbiddenException } from "@nestjs/common";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { Role } from "@shared/enums/role.enum";
import { Permission } from "../permission.enum";
import { PermissionPolicy } from "../permission.policy";
import { FORBIDDEN_SCOPE, SELF_ATTENDANCE_NOT_ALLOWED } from "../permission.errors";

function makeUser(id: string, role: Role, departmentIds?: readonly string[]): AuthUser {
  return { id, role, accessEnabled: true, departmentIds };
}

/** Returns the error code carried by the 403 body, or undefined when nothing is thrown. */
function errorCodeOf(fn: () => void): string | undefined {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ForbiddenException);
    return ((error as ForbiddenException).getResponse() as { error: string }).error;
  }
  return undefined;
}

describe("PermissionPolicy", () => {
  const policy = new PermissionPolicy();

  const member = makeUser("member-1", Role.MEMBER);
  const otherMember = makeUser("member-2", Role.MEMBER);
  const techDirector = makeUser("director-tech", Role.DIRECTOR, ["tech"]);
  const lonelyDirector = makeUser("director-none", Role.DIRECTOR);
  const coordinator = makeUser("coord-1", Role.COORDINATOR);
  const superadmin = makeUser("super-1", Role.SUPERADMIN);

  describe("all", () => {
    it("all: allows any target", () => {
      expect(policy.can(coordinator, Permission.MEMBERS_VIEW)).toBe(true);
      expect(policy.can(coordinator, Permission.MEMBERS_VIEW, { personId: "anyone" })).toBe(true);
      expect(() => policy.assertCan(coordinator, Permission.MEMBERS_VIEW)).not.toThrow();
    });
  });

  describe("none", () => {
    it("none: denies with FORBIDDEN_SCOPE", () => {
      expect(policy.can(member, Permission.MEMBERS_DEACTIVATE, { personId: "x" })).toBe(false);
      expect(errorCodeOf(() => policy.assertCan(member, Permission.MEMBERS_DEACTIVATE))).toBe(
        FORBIDDEN_SCOPE,
      );
    });
  });

  describe("own", () => {
    it("own: allows the person on themselves", () => {
      expect(policy.can(member, Permission.ACCOUNT_MANAGE_OWN, { personId: member.id })).toBe(true);
    });

    it("own: denies another person with FORBIDDEN_SCOPE", () => {
      const target = { personId: otherMember.id };
      expect(policy.can(member, Permission.ACCOUNT_MANAGE_OWN, target)).toBe(false);
      expect(
        errorCodeOf(() => policy.assertCan(member, Permission.ACCOUNT_MANAGE_OWN, target)),
      ).toBe(FORBIDDEN_SCOPE);
    });

    it("own: denies when target.personId is missing", () => {
      expect(policy.can(member, Permission.ACCOUNT_MANAGE_OWN)).toBe(false);
      expect(policy.can(member, Permission.ACCOUNT_MANAGE_OWN, {})).toBe(false);
    });
  });

  describe("department", () => {
    it("department: allows a director on a member of the same department", () => {
      expect(policy.can(techDirector, Permission.MEMBERS_VIEW, { departmentIds: ["tech"] })).toBe(
        true,
      );
    });

    it("department: denies a director on a member of another department with FORBIDDEN_SCOPE", () => {
      const target = { departmentIds: ["comms"] };
      expect(policy.can(techDirector, Permission.MEMBERS_VIEW, target)).toBe(false);
      expect(
        errorCodeOf(() => policy.assertCan(techDirector, Permission.MEMBERS_VIEW, target)),
      ).toBe(FORBIDDEN_SCOPE);
    });

    it("department: denies when the director has no department yet (GUS-91)", () => {
      const target = { departmentIds: ["tech"] };
      expect(policy.can(lonelyDirector, Permission.MEMBERS_VIEW, target)).toBe(false);
      expect(policy.can(makeUser("d", Role.DIRECTOR, []), Permission.MEMBERS_VIEW, target)).toBe(
        false,
      );
      expect(
        errorCodeOf(() => policy.assertCan(lonelyDirector, Permission.MEMBERS_VIEW, target)),
      ).toBe(FORBIDDEN_SCOPE);
    });

    it("members.edit: allows a director in the same department", () => {
      expect(
        policy.can(techDirector, Permission.MEMBERS_EDIT, { departmentIds: ["tech", "x"] }),
      ).toBe(true);
      expect(policy.can(techDirector, Permission.MEMBERS_EDIT, { departmentIds: ["comms"] })).toBe(
        false,
      );
    });
  });

  describe("allocated", () => {
    const lesson = { lessonTeacherIds: ["teacher-1"], lessonMonitorIds: ["member-1"] };

    it("allocated: allows a monitor of the lesson", () => {
      expect(policy.can(member, Permission.ATTENDANCE_TAKE_STUDENTS, lesson)).toBe(true);
    });

    it("allocated: allows a teacher of the lesson", () => {
      const teacher = makeUser("teacher-1", Role.MEMBER);
      expect(policy.can(teacher, Permission.ATTENDANCE_TAKE_STUDENTS, lesson)).toBe(true);
    });

    it("allocated: denies a member not allocated with FORBIDDEN_SCOPE", () => {
      expect(policy.can(otherMember, Permission.ATTENDANCE_TAKE_STUDENTS, lesson)).toBe(false);
      expect(
        errorCodeOf(() =>
          policy.assertCan(otherMember, Permission.ATTENDANCE_TAKE_STUDENTS, lesson),
        ),
      ).toBe(FORBIDDEN_SCOPE);
      expect(policy.can(otherMember, Permission.ATTENDANCE_TAKE_STUDENTS)).toBe(false);
    });
  });

  describe("lessonTeacher", () => {
    const teacher = makeUser("teacher-1", Role.MEMBER);
    const monitor = makeUser("monitor-1", Role.MEMBER);
    const lesson = { lessonTeacherIds: [teacher.id], lessonMonitorIds: [monitor.id, "monitor-2"] };

    it("lessonTeacher: the lesson teacher confirms a monitor", () => {
      expect(
        policy.can(teacher, Permission.ATTENDANCE_CONFIRM_MEMBER, {
          ...lesson,
          personId: monitor.id,
        }),
      ).toBe(true);
    });

    it("lessonTeacher: a monitor cannot confirm a teammate (FORBIDDEN_SCOPE)", () => {
      const target = { ...lesson, personId: "monitor-2" };
      expect(policy.can(monitor, Permission.ATTENDANCE_CONFIRM_MEMBER, target)).toBe(false);
      expect(
        errorCodeOf(() => policy.assertCan(monitor, Permission.ATTENDANCE_CONFIRM_MEMBER, target)),
      ).toBe(FORBIDDEN_SCOPE);
    });
  });

  describe("self attendance", () => {
    it.each([Role.MEMBER, Role.DIRECTOR, Role.COORDINATOR, Role.SUPERADMIN])(
      "throws SELF_ATTENDANCE_NOT_ALLOWED when %s confirms own attendance",
      (role) => {
        const user = makeUser("self-1", role);
        const target = {
          personId: user.id,
          lessonTeacherIds: [user.id],
          lessonMonitorIds: [],
        };
        expect(policy.can(user, Permission.ATTENDANCE_CONFIRM_MEMBER, target)).toBe(false);
        expect(
          errorCodeOf(() => policy.assertCan(user, Permission.ATTENDANCE_CONFIRM_MEMBER, target)),
        ).toBe(SELF_ATTENDANCE_NOT_ALLOWED);
        expect(
          errorCodeOf(() =>
            policy.assertCanAny(
              user,
              [Permission.ACCOUNT_MANAGE_OWN, Permission.ATTENDANCE_CONFIRM_MEMBER],
              target,
            ),
          ),
        ).toBe(SELF_ATTENDANCE_NOT_ALLOWED);
      },
    );

    it("director confirms the lesson teacher (scope all)", () => {
      expect(
        policy.can(techDirector, Permission.ATTENDANCE_CONFIRM_MEMBER, {
          personId: "teacher-1",
          lessonTeacherIds: ["teacher-1"],
        }),
      ).toBe(true);
    });
  });

  describe("superadmin", () => {
    it("superadmin passes every permission on third parties", () => {
      for (const permission of Object.values(Permission)) {
        expect(policy.can(superadmin, permission, { personId: "someone-else" })).toBe(true);
      }
    });
  });

  describe("assertCanAny", () => {
    it("assertCanAny: passes when any permission passes", () => {
      expect(() =>
        policy.assertCanAny(member, [Permission.ACCOUNT_MANAGE_OWN, Permission.MEMBERS_VIEW], {
          personId: member.id,
        }),
      ).not.toThrow();
    });

    it("assertCanAny: throws FORBIDDEN_SCOPE when none passes", () => {
      expect(
        errorCodeOf(() =>
          policy.assertCanAny(member, [Permission.ACCOUNT_MANAGE_OWN, Permission.MEMBERS_VIEW], {
            personId: otherMember.id,
          }),
        ),
      ).toBe(FORBIDDEN_SCOPE);
    });
  });

  describe("listFilter", () => {
    it("listFilter: maps each scope to its filter (department without ids → none)", () => {
      expect(policy.listFilter(coordinator, Permission.MEMBERS_VIEW)).toEqual({ kind: "all" });
      expect(policy.listFilter(member, Permission.MEMBERS_VIEW)).toEqual({ kind: "none" });
      expect(policy.listFilter(member, Permission.ACCOUNT_MANAGE_OWN)).toEqual({
        kind: "own",
        personId: member.id,
      });
      expect(policy.listFilter(techDirector, Permission.HOURS_VIEW_OTHERS)).toEqual({
        kind: "departments",
        departmentIds: ["tech"],
      });
      expect(policy.listFilter(lonelyDirector, Permission.HOURS_VIEW_OTHERS)).toEqual({
        kind: "none",
      });
      expect(policy.listFilter(member, Permission.ATTENDANCE_TAKE_STUDENTS)).toEqual({
        kind: "allocated",
        personId: member.id,
      });
      expect(policy.listFilter(member, Permission.ATTENDANCE_CONFIRM_MEMBER)).toEqual({
        kind: "lessonTeacher",
        personId: member.id,
      });
    });
  });
});
