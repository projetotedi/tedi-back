import { ForbiddenException } from "@nestjs/common";

export const FORBIDDEN_SCOPE = "FORBIDDEN_SCOPE";
export const SELF_ATTENDANCE_NOT_ALLOWED = "SELF_ATTENDANCE_NOT_ALLOWED";

/** 403 — the role has the permission, but the target is outside its scope. */
export class ForbiddenScopeException extends ForbiddenException {
  constructor() {
    super({ error: FORBIDDEN_SCOPE, message: "You do not have access to this resource." });
  }
}

/** 403 — nobody confirms their own attendance, in any role. */
export class SelfAttendanceNotAllowedException extends ForbiddenException {
  constructor() {
    super({
      error: SELF_ATTENDANCE_NOT_ALLOWED,
      message: "You cannot confirm your own attendance.",
    });
  }
}
