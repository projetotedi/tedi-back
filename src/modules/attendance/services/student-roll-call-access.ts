import { Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";
import {
  AssignmentRole,
  ConfirmedAssignment,
  ConfirmedStaffService,
} from "@modules/assignments/services/confirmed-staff.service";
import { ClassesService } from "@modules/classes/services/classes.service";
import { LessonSummary } from "@modules/lessons/services/lessons.service";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { Permission } from "@shared/permissions/permission.enum";
import { PermissionPolicy } from "@shared/permissions/permission.policy";
import { classArchived } from "./attendance-errors";

/**
 * The key of the advisory lock that serializes every writer of the roll call of the students of one
 * lesson (sign, justify and correct): `attendance.students:<lesson>`, apart from the one of the
 * members (`attendance.members:<lesson>`).
 */
export function studentRollCallLockKey(lessonId: string): string {
  return `attendance.students:${lessonId}`;
}

/**
 * The target of attendance.takeStudents in a lesson (scope `allocated`): its CONFIRMED teacher in
 * `lessonTeacherIds` and its CONFIRMED monitors in `lessonMonitorIds`. A pending, declined or
 * cancelled assignment is not in `staff`, so it allocates nobody.
 */
export function rollCallTargetOf(staff: readonly ConfirmedAssignment[]): {
  lessonTeacherIds: string[];
  lessonMonitorIds: string[];
} {
  const lessonTeacherIds: string[] = [];
  const lessonMonitorIds: string[] = [];
  for (const assignment of staff) {
    switch (assignment.role) {
      case AssignmentRole.TEACHER:
        lessonTeacherIds.push(assignment.personId);
        break;
      case AssignmentRole.MONITOR:
        lessonMonitorIds.push(assignment.personId);
        break;
      default: {
        const unknownRole: never = assignment.role;
        throw new Error(`Unknown assignment role: ${String(unknownRole)}.`);
      }
    }
  }
  return { lessonTeacherIds, lessonMonitorIds };
}

/**
 * What the writes of the roll call of the students share (the batch and the justification and
 * correction of one attendance, GUS-166): the locks taken after the lesson, in the order of section
 * 18.1 (S3), and who takes the roll call of a lesson (S6).
 */
@Injectable()
export class StudentRollCallAccess {
  constructor(
    private readonly classes: ClassesService,
    private readonly confirmedStaff: ConfirmedStaffService,
    private readonly policy: PermissionPolicy,
  ) {}

  /**
   * The class of the lesson FOR SHARE, then 409 CLASS_ARCHIVED, then the advisory lock of the roll
   * call of the lesson. The class held FOR SHARE is what serializes the roll call with the writes of
   * the enrollments of the class (they lock it FOR UPDATE first), so the roster read after it does
   * not change until the commit. The foreign key requires the class: a missing one throws.
   */
  async lockClassAndRollCall(manager: EntityManager, lesson: LessonSummary): Promise<void> {
    const schoolClass = await this.classes.getClassSummary(lesson.classId, manager, {
      forShare: true,
    });
    if (schoolClass === null) {
      throw new Error(
        `Class ${lesson.classId} of lesson ${lesson.id} was not found, but the foreign key requires it.`,
      );
    }
    if (schoolClass.archivedAt !== null) throw classArchived();

    await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      studentRollCallLockKey(lesson.id),
    ]);
  }

  /**
   * 403 FORBIDDEN_SCOPE unless the actor takes the roll call of the lesson: a member only as its
   * confirmed teacher or a confirmed monitor, a director and coordination always. The confirmed
   * assignments are read FOR SHARE, so a cancellation of one in flight is waited for.
   */
  async assertCanTake(actor: AuthUser, lessonId: string, manager: EntityManager): Promise<void> {
    const staff = await this.confirmedStaff.findConfirmedAssignments(lessonId, manager, {
      forShare: true,
    });
    this.policy.assertCan(actor, Permission.ATTENDANCE_TAKE_STUDENTS, rollCallTargetOf(staff));
  }

  /** The same decision as `assertCanTake`, as a plain read: whether the list shows the notes (S7). */
  async canTake(actor: AuthUser, lessonId: string): Promise<boolean> {
    const staff = await this.confirmedStaff.findConfirmedAssignments(lessonId);
    return this.policy.can(actor, Permission.ATTENDANCE_TAKE_STUDENTS, rollCallTargetOf(staff));
  }
}
