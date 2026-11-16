import { ForbiddenException } from "@nestjs/common";

export const FORBIDDEN_SCOPE = "FORBIDDEN_SCOPE";
export const SELF_ATTENDANCE_NOT_ALLOWED = "SELF_ATTENDANCE_NOT_ALLOWED";
export const OWN_ACCOUNT = "OWN_ACCOUNT";

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

/**
 * 403 — nobody changes the role, the access or the participation of their own account
 * (decision 23 of E9.a): /access and the member deactivation answer the same body.
 */
export class OwnAccountException extends ForbiddenException {
  constructor() {
    super({ error: OWN_ACCOUNT, message: "Cannot act on your own account." });
  }
}
