import { Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { MembersService } from "@modules/people/services/members.service";
import { CurrentUser } from "@shared/decorators/current-user.decorator";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { Permission } from "@shared/permissions/permission.enum";
import { PermissionPolicy } from "@shared/permissions/permission.policy";
import { RequirePermission } from "@shared/permissions/require-permission.decorator";
import { FAKE_DEPARTMENTS, FAKE_LESSON_STAFF, withFakeDepartments } from "./permission-fixtures";

function lessonStaff(lessonId: string): { teacherIds: string[]; monitorIds: string[] } {
  return FAKE_LESSON_STAFF.get(lessonId) ?? { teacherIds: [], monitorIds: [] };
}

/**
 * Stand-in for the domain modules that do not exist yet (members, hours, attendance).
 * Exercises @RequirePermission + PermissionPolicy end to end.
 * Registered only by PermissionsTestModule, never in production.
 */
@Controller("test/permissions")
export class PermissionDemoController {
  constructor(
    private readonly policy: PermissionPolicy,
    private readonly members: MembersService,
  ) {}

  @Get("members/:personId")
  @RequirePermission(Permission.MEMBERS_VIEW)
  viewMember(
    @Param("personId") personId: string,
    @CurrentUser() user: AuthUser,
  ): { personId: string } {
    this.policy.assertCan(withFakeDepartments(user), Permission.MEMBERS_VIEW, {
      personId,
      departmentIds: FAKE_DEPARTMENTS.get(personId) ?? [],
    });
    return { personId };
  }

  /**
   * Same rule as members/:personId, but with the REAL departments (GUS-91): the actor's come
   * from the AuthGuard (AuthUser.departmentIds, no withFakeDepartments) and the target's from
   * its approved member profile, the way a domain service loads them before the policy.
   */
  @Get("real-members/:personId")
  @RequirePermission(Permission.MEMBERS_VIEW)
  async viewMemberWithRealDepartments(
    @Param("personId") personId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ personId: string }> {
    const target = await this.members.findAccessFacts(personId);
    this.policy.assertCan(user, Permission.MEMBERS_VIEW, {
      personId,
      departmentIds: target.departmentIds,
    });
    return { personId };
  }

  @Patch("members/:personId")
  @RequirePermission(Permission.MEMBERS_EDIT)
  editMember(
    @Param("personId") personId: string,
    @CurrentUser() user: AuthUser,
  ): { personId: string } {
    this.policy.assertCan(withFakeDepartments(user), Permission.MEMBERS_EDIT, {
      personId,
      departmentIds: FAKE_DEPARTMENTS.get(personId) ?? [],
    });
    return { personId };
  }

  @Patch("members/:personId/deactivate")
  @RequirePermission(Permission.MEMBERS_DEACTIVATE)
  deactivateMember(): { ok: boolean } {
    return { ok: true };
  }

  @Get("hours/overview")
  @RequirePermission(Permission.HOURS_VIEW_OTHERS)
  hoursOverview(): { ok: boolean } {
    return { ok: true };
  }

  @Get("hours/entries")
  @RequirePermission(Permission.ACCOUNT_MANAGE_OWN)
  hoursEntries(
    @Query("personId") personId: string,
    @CurrentUser() user: AuthUser,
  ): { personId: string } {
    this.policy.assertCanAny(
      withFakeDepartments(user),
      [Permission.ACCOUNT_MANAGE_OWN, Permission.MEMBERS_VIEW],
      { personId, departmentIds: FAKE_DEPARTMENTS.get(personId) ?? [] },
    );
    return { personId };
  }

  @Post("lessons/:lessonId/attendance")
  @HttpCode(201)
  @RequirePermission(Permission.ATTENDANCE_TAKE_STUDENTS)
  takeAttendance(
    @Param("lessonId") lessonId: string,
    @CurrentUser() user: AuthUser,
  ): { lessonId: string } {
    const staff = lessonStaff(lessonId);
    this.policy.assertCan(user, Permission.ATTENDANCE_TAKE_STUDENTS, {
      lessonTeacherIds: staff.teacherIds,
      lessonMonitorIds: staff.monitorIds,
    });
    return { lessonId };
  }

  @Post("lessons/:lessonId/member-attendance/:personId")
  @HttpCode(201)
  @RequirePermission(Permission.ATTENDANCE_CONFIRM_MEMBER)
  confirmMemberAttendance(
    @Param("lessonId") lessonId: string,
    @Param("personId") personId: string,
    @CurrentUser() user: AuthUser,
  ): { lessonId: string; personId: string } {
    const staff = lessonStaff(lessonId);
    this.policy.assertCan(user, Permission.ATTENDANCE_CONFIRM_MEMBER, {
      personId,
      lessonTeacherIds: staff.teacherIds,
      lessonMonitorIds: staff.monitorIds,
    });
    return { lessonId, personId };
  }
}
