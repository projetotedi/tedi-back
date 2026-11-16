import { Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource, EntityManager } from "typeorm";
import {
  ConfirmedStaffCount,
  NO_CONFIRMED_STAFF,
  toLessonCoverage,
} from "@modules/lessons/services/lesson-coverage";
import { LessonListingService } from "@modules/lessons/services/lesson-listing.service";
import { LessonsService, LessonStatus } from "@modules/lessons/services/lessons.service";
import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";
import { MembersService } from "@modules/people/services/members.service";
import { PeopleService } from "@modules/people/services/people.service";
import { todayInAppTimeZone } from "@shared/dates/calendar-date";
import { Clock } from "@shared/dates/clock";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { AUDITABLE_ACTION_EVENT, AuditableAction } from "@shared/events/auditable-action.event";
import { Permission } from "@shared/permissions/permission.enum";
import { PermissionPolicy } from "@shared/permissions/permission.policy";
import { ApplyToLessonDto } from "../dto/apply-to-lesson.dto";
import { LessonAssignmentResponseDto } from "../dto/lesson-assignment.response.dto";
import {
  PendingApplicationGroupResponseDto,
  PendingApplicationsResponseDto,
} from "../dto/pending-applications.response.dto";
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
  applicationNotFound,
  applicationNotPending,
  lessonCancelled,
  lessonInPast,
  lessonNotFound,
  memberInactive,
  roleFull,
} from "./assignment-errors";
import { toAssignmentLesson, toLessonAssignmentResponse } from "./assignment-response.mapper";
import { LessonStaffCounterService } from "./lesson-staff-counter.service";
import { hasOpenPlace, isClosedForApplications } from "./role-vacancy";

/**
 * The advisory lock of the confirmed staff of one lesson, taken by the approval of an application:
 * two approvals of the same lesson wait for each other there, and the one that waited counts again
 * after it. Exported for the e2e, which holds it to prove the wait.
 */
export function lessonStaffLockKey(lessonId: string): string {
  return `assignments.lesson-staff:${lessonId}`;
}

/** What a review (approve, decline) did: nothing (a no-op) or a change, which is audited. */
interface ReviewOutcome {
  changed: boolean;
  application: LessonAssignment;
}

/**
 * The applications (candidaturas) of the members to the lessons (F5.1, GUS-160): a member applies
 * for a role in a lesson, and the application is an assignment with `source` `application` and
 * `status` `pending`, the same entity as the direct assignment of the GUS-158.
 *
 * A place is the coverage (C1): only CONFIRMED assignments take one, so a pending application fills
 * none and several applications can wait for the same place. The rule is `hasOpenPlace`
 * (`role-vacancy.ts`), the same one the lessons with an open place follow.
 *
 * Locks, always in this order, so no two writes wait for each other in a circle (docs/ARCHITECTURE.md
 * section 15.1 lists every transaction that locks these rows):
 * - applying: the lesson FOR SHARE, then the member FOR SHARE, then the insert. No advisory lock: a
 *   pending application takes no place, so an "open" read a moment late only makes a pending
 *   application that the approval refuses later with ROLE_FULL. Two applications of the same member
 *   at the same time are settled by the partial unique index of the active place;
 * - approving: the application FOR UPDATE, then the lesson FOR SHARE, then the member FOR SHARE,
 *   then the advisory lock of the lesson (`lessonStaffLockKey`), then the count of the confirmed
 *   staff, made again under it, then the update. FOR SHARE does not conflict with FOR SHARE, so two
 *   approvals of monitors of the same lesson would both read "1 of 2" and end at "3 of 2": the
 *   advisory lock is where they wait for each other, and in READ COMMITTED the count after it is a
 *   new statement that sees what the other one committed. It is the LAST lock taken: after it the
 *   transaction only counts and writes its own row;
 * - declining: the application FOR UPDATE, then the update.
 * Every transaction asks for them in the same order (assignment, lesson, person, advisory lock),
 * and `lessons` and `people` never lock an assignment nor take the advisory lock.
 *
 * Only these routes answer ROLE_FULL: the direct confirmation of the GUS-158
 * (`PATCH /assignments/:id/confirm`) stays as it was, the decision of the board, with no limit of
 * monitors.
 *
 * The note is free text for whoever reviews and for its author (RNF-13): the queue asks the
 * `PermissionPolicy` whether the actor reads it, and it is never in an event.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly clock: Clock,
    private readonly lessons: LessonsService,
    private readonly members: MembersService,
    private readonly people: PeopleService,
    private readonly listing: LessonListingService,
    private readonly staffCounter: LessonStaffCounterService,
    private readonly policy: PermissionPolicy,
  ) {}

  /**
   * The member of the session applies for a role in a lesson: the application is born `pending`,
   * `source` `application`, and its author is the member herself. The applicant is always the actor:
   * the body has no `personId`.
   *
   * Errors, in the order they are answered: 400 VALIDATION_FAILED (the DTO), 404 LESSON_NOT_FOUND,
   * 409 LESSON_CANCELLED, 409 LESSON_IN_PAST (a lesson before today in America/Sao_Paulo, or already
   * done: `isClosedForApplications`; today is still taken while it is not done), 409 MEMBER_INACTIVE (she is not an active member, or no longer a member), 409
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
      if (isClosedForApplications(lesson, today)) throw lessonInPast();

      const member = await this.members.getMemberSummary(actor.id, manager, { forShare: true });
      // A person that is not an active member (or no longer a member at all) cannot take work.
      if (member === null || !member.active) throw memberInactive();

      if (await hasActiveAssignment(manager, lesson.id, member.id)) throw alreadyApplied();

      const staff = await this.confirmedStaffOf(lesson.id, manager);
      if (!hasOpenPlace(dto.role, lesson, staff)) throw roleFull();

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
   * The queue of the pending applications (`source` `application`, `status` `pending`), of any
   * lesson: a cancelled one and one that already happened come too, with the status and the date of
   * the lesson, so they can be declined (an application does not resolve itself, A13). A direct
   * pending assignment is not an application and is left out. The route only takes
   * `?status=pending` (the DTO answers 400 to anything else), so the predicate is fixed here and the
   * service takes no query.
   *
   * Grouped by lesson, the soonest lesson first (by date, start time and id), and inside a lesson the
   * oldest application first (by `createdAt`, then id). Each group carries the lesson with its class,
   * its coverage (confirmed assignments only) and its applications. `total` is the number of the
   * applications listed, the counter of the button, so the button never says another number than the
   * list: an application whose lesson does not come back (a soft-deleted lesson, which no route
   * makes) is left out of both.
   *
   * The note is shown when the `PermissionPolicy` says the actor has `assignments.review`, asked once
   * for the list. Not paginated: the queue holds dozens.
   *
   * A plain read: no transaction, no lock and no event. Four reads, whatever the number of
   * applications: the applications, the agenda of their lessons (`findAgendaByIds`), the confirmed
   * staff of those lessons and the names. They run one after the other on purpose: they are
   * independent, but with dozens of rows running them in parallel only holds more connections of the
   * pool at once.
   */
  async listPending(actor: AuthUser): Promise<PendingApplicationsResponseDto> {
    const visibility = { canSeeNote: this.policy.can(actor, Permission.ASSIGNMENTS_REVIEW) };

    const applications = await this.dataSource.getRepository(LessonAssignment).find({
      where: { source: AssignmentSource.APPLICATION, status: AssignmentStatus.PENDING },
      order: { createdAt: "ASC", id: "ASC" },
    });
    if (applications.length === 0) return { total: 0, lessons: [] };

    const byLesson = new Map<string, LessonAssignment[]>();
    for (const application of applications) {
      const ofLesson = byLesson.get(application.lessonId);
      if (ofLesson === undefined) byLesson.set(application.lessonId, [application]);
      else ofLesson.push(application);
    }
    const lessonIds = [...byLesson.keys()];

    const agenda = await this.listing.findAgendaByIds(lessonIds);
    const staff = await this.staffCounter.countConfirmedStaff(lessonIds);
    const people = await this.people.findRefsByIds([
      ...new Set(applications.map((application) => application.personId)),
    ]);
    const peopleById = new Map(people.map((person) => [person.id, person]));

    const lessons = agenda.map((ref): PendingApplicationGroupResponseDto => {
      // The agenda only answers the ids it was asked for: another one is a broken contract, not a
      // lesson to skip quietly.
      const ofLesson = byLesson.get(ref.id);
      if (ofLesson === undefined) {
        throw new Error(`The agenda answered the lesson ${ref.id}, which was not asked for.`);
      }

      return {
        lesson: toAssignmentLesson(ref),
        coverage: toLessonCoverage(ref, staff.get(ref.id) ?? NO_CONFIRMED_STAFF).coverage,
        applications: ofLesson.map((application) =>
          toLessonAssignmentResponse(
            application,
            peopleById.get(application.personId) ?? null,
            visibility,
          ),
        ),
      };
    });

    return {
      total: lessons.reduce((sum, group) => sum + group.applications.length, 0),
      lessons,
    };
  }

  /**
   * Approves a pending application: it becomes a confirmed assignment, and the coverage of the
   * lesson counts the member from now on. Who approved it and when go to `reviewedById` and
   * `reviewedAt` (the same instant as `updatedAt`). The lesson may have already happened: approving
   * it afterwards is the record of who was there (A12).
   *
   * Approving one that is already confirmed is a no-op that answers 200: no write, no event, and the
   * lesson and the member are not even looked at. Otherwise, errors, in the order they are answered:
   * 404 APPLICATION_NOT_FOUND (unknown, or a direct assignment), 409 APPLICATION_NOT_PENDING
   * (declined or cancelled), 409 LESSON_CANCELLED, 409 MEMBER_INACTIVE (her access was disabled or
   * she left while the application waited) and 409 ROLE_FULL (the place was taken while it waited:
   * a confirmed teacher, or the confirmed monitors at what the lesson expects, or nothing expected).
   *
   * The locks, and why the count is made again after the advisory lock, are in the JSDoc of the
   * class. Past them, the unique index of the confirmed teacher has the last word: its violation is
   * ROLE_FULL too.
   *
   * Emits LESSON_ASSIGNMENT_APPROVED after the commit, only when it was approved now. The answer
   * carries the note: the route needs `assignments.review`, which is who reads it.
   */
  async approve(applicationId: string, actorId: string): Promise<LessonAssignmentResponseDto> {
    const now = this.clock.now();

    const outcome = await this.runInTransaction(async (manager): Promise<ReviewOutcome> => {
      const application = await this.loadApplication(manager, applicationId);
      if (application.status === AssignmentStatus.CONFIRMED) return { changed: false, application };
      if (application.status !== AssignmentStatus.PENDING) throw applicationNotPending();

      const lesson = await this.lessons.getLessonSummary(application.lessonId, manager, {
        forShare: true,
      });
      if (lesson === null) {
        throw new Error(
          `Lesson ${application.lessonId} of application ${application.id} was not found, but the foreign key requires it.`,
        );
      }
      if (lesson.status === LessonStatus.CANCELLED) throw lessonCancelled();

      const member = await this.members.getMemberSummary(application.personId, manager, {
        forShare: true,
      });
      if (member === null || !member.active) throw memberInactive();

      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        lessonStaffLockKey(lesson.id),
      ]);
      // Counted AFTER the lock, in a statement of its own: it sees the approval that went first.
      const staff = await this.confirmedStaffOf(lesson.id, manager);
      if (!hasOpenPlace(application.role, lesson, staff)) throw roleFull();

      application.status = AssignmentStatus.CONFIRMED;
      application.reviewedById = actorId;
      application.reviewedAt = now;
      // The instant of the approval is the one of the update. Left alone, the table would fill
      // updated_at with its own CURRENT_TIMESTAMP.
      application.updatedAt = now;
      await manager.save(application);

      return { changed: true, application };
    });

    const { application } = outcome;
    if (outcome.changed) {
      this.emit({
        action: AuditableAction.LESSON_ASSIGNMENT_APPROVED,
        actorId,
        assignmentId: application.id,
        before: { status: AssignmentStatus.PENDING },
        after: {
          status: AssignmentStatus.CONFIRMED,
          reviewedAt: now,
          lessonId: application.lessonId,
          personId: application.personId,
          role: application.role,
        },
        occurredAt: now,
      });
    }

    return toLessonAssignmentResponse(application, await this.personRefOf(application.personId), {
      canSeeNote: true,
    });
  }

  /**
   * Declines a pending application: status `declined`, with who did it and when (`reviewedById`,
   * `reviewedAt`, the same instant as `updatedAt`). The row stays, the place of the member in the
   * lesson is free again (`declined` does not count in the index of the active place), she sees the
   * status in "Minhas aulas" and can apply again. It has no body and no reason, and it looks neither
   * at the lesson nor at the member: an application of a cancelled or past lesson is declined too.
   *
   * Declining one that is already declined is a no-op that answers 200, with no write and no event.
   * Otherwise, errors: 404 APPLICATION_NOT_FOUND and 409 APPLICATION_NOT_PENDING (approved or
   * cancelled: an approved one leaves through `PATCH /assignments/:id/cancel`).
   *
   * The application is locked FOR UPDATE until the commit, so an approval and a decline of it at the
   * same time are decided once: the second one finds it decided.
   *
   * Emits LESSON_ASSIGNMENT_DECLINED after the commit, only when it was declined now. The answer
   * carries the note, as the approval.
   */
  async reject(applicationId: string, actorId: string): Promise<LessonAssignmentResponseDto> {
    const now = this.clock.now();

    const outcome = await this.runInTransaction(async (manager): Promise<ReviewOutcome> => {
      const application = await this.loadApplication(manager, applicationId);
      if (application.status === AssignmentStatus.DECLINED) return { changed: false, application };
      if (application.status !== AssignmentStatus.PENDING) throw applicationNotPending();

      application.status = AssignmentStatus.DECLINED;
      application.reviewedById = actorId;
      application.reviewedAt = now;
      application.updatedAt = now;
      await manager.save(application);

      return { changed: true, application };
    });

    const { application } = outcome;
    if (outcome.changed) {
      this.emit({
        action: AuditableAction.LESSON_ASSIGNMENT_DECLINED,
        actorId,
        assignmentId: application.id,
        before: { status: AssignmentStatus.PENDING },
        after: {
          status: AssignmentStatus.DECLINED,
          reviewedAt: now,
          lessonId: application.lessonId,
          personId: application.personId,
          role: application.role,
        },
        occurredAt: now,
      });
    }

    return toLessonAssignmentResponse(application, await this.personRefOf(application.personId), {
      canSeeNote: true,
    });
  }

  /**
   * The application, locked FOR UPDATE until the end of the transaction. A direct assignment is not
   * an application: the `source` is part of the lookup, so it answers the same 404.
   */
  private async loadApplication(manager: EntityManager, id: string): Promise<LessonAssignment> {
    const application = await manager.findOne(LessonAssignment, {
      where: { id, source: AssignmentSource.APPLICATION },
      lock: { mode: "pessimistic_write" },
    });
    if (application === null) throw applicationNotFound();

    return application;
  }

  /**
   * The confirmed staff of one lesson, counted inside the transaction of the caller (its `manager`),
   * in a statement of its own; a lesson with nobody confirmed reads as `NO_CONFIRMED_STAFF`. What
   * applying and approving check the vacancy against.
   */
  private async confirmedStaffOf(
    lessonId: string,
    manager: EntityManager,
  ): Promise<ConfirmedStaffCount> {
    const counts = await this.staffCounter.countConfirmedStaff([lessonId], manager);
    return counts.get(lessonId) ?? NO_CONFIRMED_STAFF;
  }

  /**
   * The id and the name of the member of an application, read after the transaction has ended:
   * `PeopleService.findRefsByIds` takes no `manager`, and a read of another connection must not wait
   * inside a transaction that holds one (the same as `AssignmentsService`). Null when she is gone.
   */
  private async personRefOf(personId: string): Promise<PersonRefDto | null> {
    const [person] = await this.people.findRefsByIds([personId]);
    return person ?? null;
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
