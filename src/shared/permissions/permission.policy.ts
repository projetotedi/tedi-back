import { Injectable } from "@nestjs/common";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { Permission } from "./permission.enum";
import { scopeFor } from "./permission-matrix";
import { ListScopeFilter, PermissionTarget } from "./permission-target.type";
import { ForbiddenScopeException, SelfAttendanceNotAllowedException } from "./permission.errors";
import { Scope } from "./scope.type";

/**
 * Resolves the scope of a permission against facts about the target.
 * Synchronous and dependency-free: the calling service loads the facts
 * (departments, lesson staff) and passes them in a PermissionTarget.
 */
@Injectable()
export class PermissionPolicy {
  scopeOf(user: AuthUser, permission: Permission): Scope {
    return scopeFor(user.role, permission);
  }

  can(user: AuthUser, permission: Permission, target?: PermissionTarget): boolean {
    if (this.isSelfAttendance(user, permission, target)) return false;
    // Fail closed: confirming member attendance needs to know who is being confirmed,
    // otherwise the self-attendance rule cannot be checked (not even for scope "all").
    if (permission === Permission.ATTENDANCE_CONFIRM_MEMBER && target?.personId === undefined) {
      return false;
    }

    switch (this.scopeOf(user, permission)) {
      case "none":
        return false;
      case "all":
        return true;
      case "own":
        return target?.personId !== undefined && target.personId === user.id;
      case "department": {
        const mine = user.departmentIds ?? [];
        const theirs = target?.departmentIds ?? [];
        return mine.some((id) => theirs.includes(id));
      }
      case "allocated":
        return (
          (target?.lessonTeacherIds ?? []).includes(user.id) ||
          (target?.lessonMonitorIds ?? []).includes(user.id)
        );
      case "lessonTeacher":
        return (target?.lessonTeacherIds ?? []).includes(user.id);
    }
  }

  /**
   * Throws SELF_ATTENDANCE_NOT_ALLOWED when the self-attendance rule applies,
   * FORBIDDEN_SCOPE when the permission does not cover the target.
   */
  assertCan(user: AuthUser, permission: Permission, target?: PermissionTarget): void {
    if (this.isSelfAttendance(user, permission, target)) {
      throw new SelfAttendanceNotAllowedException();
    }
    if (!this.can(user, permission, target)) {
      throw new ForbiddenScopeException();
    }
  }

  /**
   * Passes when any of the permissions covers the target.
   * The self-attendance rule takes precedence over everything else.
   */
  assertCanAny(
    user: AuthUser,
    permissions: readonly Permission[],
    target?: PermissionTarget,
  ): void {
    for (const permission of permissions) {
      if (this.isSelfAttendance(user, permission, target)) {
        throw new SelfAttendanceNotAllowedException();
      }
    }
    if (!permissions.some((permission) => this.can(user, permission, target))) {
      throw new ForbiddenScopeException();
    }
  }

  /**
   * Filter for listings. The service translates it into the WHERE clause of the
   * query; it never loads everything and filters afterwards.
   */
  listFilter(user: AuthUser, permission: Permission): ListScopeFilter {
    switch (this.scopeOf(user, permission)) {
      case "all":
        return { kind: "all" };
      case "none":
        return { kind: "none" };
      case "own":
        return { kind: "own", personId: user.id };
      case "department": {
        const departmentIds = user.departmentIds ?? [];
        return departmentIds.length === 0
          ? { kind: "none" }
          : { kind: "departments", departmentIds };
      }
      case "allocated":
        return { kind: "allocated", personId: user.id };
      case "lessonTeacher":
        return { kind: "lessonTeacher", personId: user.id };
    }
  }

  /** Nobody confirms their own attendance — applies to every role, SUPERADMIN included. */
  private isSelfAttendance(
    user: AuthUser,
    permission: Permission,
    target?: PermissionTarget,
  ): boolean {
    return (
      permission === Permission.ATTENDANCE_CONFIRM_MEMBER &&
      target?.personId !== undefined &&
      target.personId === user.id
    );
  }
}
