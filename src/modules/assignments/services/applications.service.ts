import { Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource, EntityManager } from "typeorm";
import { NO_CONFIRMED_STAFF } from "@modules/lessons/services/lesson-coverage";
import { LessonsService, LessonStatus } from "@modules/lessons/services/lessons.service";
import { MembersService } from "@modules/people/services/members.service";
import { todayInAppTimeZone } from "@shared/dates/calendar-date";
import { Clock } from "@shared/dates/clock";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { AUDITABLE_ACTION_EVENT, AuditableAction } from "@shared/events/auditable-action.event";
import { ApplyToLessonDto } from "../dto/apply-to-lesson.dto";
import { LessonAssignmentResponseDto } from "../dto/lesson-assignment.response.dto";
import { LessonAssignment } from "../entities/lesson-assignment.entity";
import { AssignmentSource } from "../enums/assignment-source.enum";
import { AssignmentStatus } from "../enums/assignment-status.enum";
import { AssignmentAudit, buildAssignmentAuditEvent } from "./assignment-audit";
import {
  ACTIVE_UNIQUE_INDEX,
  CONFIRMED_TEACHER_UNIQUE_INDEX,
  hasActiveAssignment,
  LESSON_FOREIGN_KEY,
  PERSON_FOREIGN_KEY,
  violatedConstraint,
} from "./assignment-constraints";
import {
  alreadyApplied,
  lessonCancelled,
  lessonInPast,
  lessonNotFound,
  memberInactive,
  roleFull,
} from "./assignment-errors";
import { toLessonAssignmentResponse } from "./assignment-response.mapper";
import { LessonStaffCounterService } from "./lesson-staff-counter.service";
import { hasOpenPlace } from "./role-vacancy";

/**
 * The applications (candidaturas) of the members to the lessons (F5.1, GUS-160): a member applies
 * for a role in a lesson, and the application is an assignment with `source` `application` and
 * `status` `pending`, the same entity as the direct assignment of the GUS-158.
 *
 * A place is the coverage (C1): only CONFIRMED assignments take one, so a pending application fills
 * none and several applications can wait for the same place. The rule is `hasOpenPlace`
 * (`role-vacancy.ts`), the same one the lessons with an open place follow.
 *
 * Locks, always in this order, the one of the GUS-158 (docs/ARCHITECTURE.md sections 15 and 15.1):
 * applying takes the lesson FOR SHARE, then the member FOR SHARE, then inserts. It takes no
 * advisory lock: a pending application takes no place, so an "open" read a moment late only makes a
 * pending application that the approval refuses later with ROLE_FULL. Two applications of the same
 * member at the same time are settled by the partial unique index of the active place.
 *
 * The note is free text for whoever reviews (RNF-13): it is never in an event.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly clock: Clock,
    private readonly lessons: LessonsService,
    private readonly members: MembersService,
    private readonly staffCounter: LessonStaffCounterService,
  ) {}

  /**
   * The member of the session applies for a role in a lesson: the application is born `pending`,
   * `source` `application`, and its author is the member herself. The applicant is always the actor:
   * the body has no `personId`.
   *
   * Errors, in the order they are answered: 400 VALIDATION_FAILED (the DTO), 404 LESSON_NOT_FOUND,
   * 409 LESSON_CANCELLED, 409 LESSON_IN_PAST (a lesson before today in America/Sao_Paulo; today is
   * still taken), 409 MEMBER_INACTIVE (she is not an active member, or no longer a member), 409
   * ALREADY_APPLIED (she already holds a place in the lesson, as either role and from either source:
   * she learns that she is in, not that it is full) and 409 ROLE_FULL (no open place for the role).
   *
   * The lesson and the member are locked FOR SHARE until the commit, so neither can be cancelled or
   * disabled between the checks and the insert. Past the pre-checks, the constraints have the last
   * word: their violations are mapped to the same errors.
   *
   * Emits LESSON_ASSIGNMENT_APPLIED after the commit, without the note, with the member as actor.
   */
  async apply(
    lessonId: string,
    dto: ApplyToLessonDto,
    actor: AuthUser,
  ): Promise<LessonAssignmentResponseDto> {
    const now = this.clock.now();
    const today = todayInAppTimeZone(now);

    const created = await this.runInTransaction(async (manager) => {
      const lesson = await this.lessons.getLessonSummary(lessonId, manager, { forShare: true });
      if (lesson === null) throw lessonNotFound();
      if (lesson.status === LessonStatus.CANCELLED) throw lessonCancelled();
      // "YYYY-MM-DD" strings compare in the order of the calendar.
      if (lesson.date < today) throw lessonInPast();

      const member = await this.members.getMemberSummary(actor.id, manager, { forShare: true });
      // A person that is not an active member (or no longer a member at all) cannot take work.
      if (member === null || !member.active) throw memberInactive();

      if (await hasActiveAssignment(manager, lesson.id, member.id)) throw alreadyApplied();

      const counts = await this.staffCounter.countConfirmedStaff([lesson.id], manager);
      if (!hasOpenPlace(dto.role, lesson, counts.get(lesson.id) ?? NO_CONFIRMED_STAFF)) {
        throw roleFull();
      }

      const assignment = await manager.save(
        manager.create(LessonAssignment, {
          lessonId: lesson.id,
          personId: member.id,
          role: dto.role,
          status: AssignmentStatus.PENDING,
          source: AssignmentSource.APPLICATION,
          note: dto.note ?? null,
          createdById: member.id,
          reviewedById: null,
          reviewedAt: null,
          cancelledById: null,
          cancelledAt: null,
        }),
      );

      return { assignment, person: { id: member.id, name: member.name } };
    });

    const { assignment, person } = created;
    this.emit({
      action: AuditableAction.LESSON_ASSIGNMENT_APPLIED,
      actorId: person.id,
      assignmentId: assignment.id,
      before: null,
      after: {
        lessonId: assignment.lessonId,
        personId: assignment.personId,
        role: assignment.role,
        status: assignment.status,
        source: assignment.source,
      },
      occurredAt: now,
    });

    // The author reads the note she has just written.
    return toLessonAssignmentResponse(assignment, person, { canSeeNote: true });
  }

  /**
   * Runs the work in a transaction and turns the constraint violations of `lesson_assignments` into
   * the errors of the applications: they are the safety net, in case the rows move under the
   * pre-checks (two requests at the same time pass them together).
   */
  private async runInTransaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    try {
      return await this.dataSource.transaction(work);
    } catch (error) {
      throw mapApplicationConstraintError(error);
    }
  }

  /** Emits the audit event, with the instant of the operation (one read of the clock for each). */
  private emit(audit: AssignmentAudit): void {
    this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, buildAssignmentAuditEvent(audit));
  }
}

/**
 * The constraint violations that mean an error of the applications: a second active place of the
 * member in the lesson (ALREADY_APPLIED), a second confirmed teacher (ROLE_FULL, never the
 * LESSON_TEACHER_TAKEN of the direct assignment), and a lesson or a member that does not exist (the
 * lookups with a lock normally answer first). Anything else goes through as it came.
 */
function mapApplicationConstraintError(error: unknown): unknown {
  const violation = violatedConstraint(error);
  if (violation === null) return error;
  const { code, constraint } = violation;

  if (code === "23505" && constraint === ACTIVE_UNIQUE_INDEX) return alreadyApplied();
  if (code === "23505" && constraint === CONFIRMED_TEACHER_UNIQUE_INDEX) return roleFull();
  if (code === "23503" && constraint === LESSON_FOREIGN_KEY) return lessonNotFound();
  if (code === "23503" && constraint === PERSON_FOREIGN_KEY) return memberInactive();
  return error;
}
