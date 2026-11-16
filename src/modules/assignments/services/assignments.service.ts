import { Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource, EntityManager, In, QueryFailedError } from "typeorm";
import { LessonsService, LessonStatus } from "@modules/lessons/services/lessons.service";
import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";
import { MembersService } from "@modules/people/services/members.service";
import { PeopleService } from "@modules/people/services/people.service";
import { Clock } from "@shared/dates/clock";
import { AuthUser } from "@shared/decorators/auth-user.type";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { Permission } from "@shared/permissions/permission.enum";
import { PermissionPolicy } from "@shared/permissions/permission.policy";
import { CreateAssignmentDto } from "../dto/create-assignment.dto";
import { LessonAssignmentResponseDto } from "../dto/lesson-assignment.response.dto";
import { MemberAssignmentResponseDto } from "../dto/member-assignment.response.dto";
import { LessonAssignment } from "../entities/lesson-assignment.entity";
import { AssignmentRole } from "../enums/assignment-role.enum";
import { AssignmentSource } from "../enums/assignment-source.enum";
import { ACTIVE_ASSIGNMENT_STATUSES, AssignmentStatus } from "../enums/assignment-status.enum";
import {
  assignmentNotActive,
  assignmentNotFound,
  assignmentNotPending,
  duplicateRoleInLesson,
  lessonCancelled,
  lessonNotFound,
  lessonTeacherTaken,
  memberInactive,
  memberNotFound,
  memberNotFoundInBody,
} from "./assignment-errors";
import {
  toLessonAssignmentResponse,
  toMemberAssignmentResponse,
} from "./assignment-response.mapper";

const ASSIGNMENT_TARGET_TYPE = "lesson_assignment";

const ACTIVE_UNIQUE_INDEX = "uq_lesson_assignments_lesson_id_person_id_active";
const CONFIRMED_TEACHER_UNIQUE_INDEX = "uq_lesson_assignments_lesson_id_confirmed_teacher";
const PERSON_FOREIGN_KEY = "fk_lesson_assignments_person_id";
const LESSON_FOREIGN_KEY = "fk_lesson_assignments_lesson_id";

type ConfirmOutcome =
  | { changed: false; assignment: LessonAssignment }
  | { changed: true; assignment: LessonAssignment };

type CancelOutcome =
  | { changed: false; assignment: LessonAssignment }
  | { changed: true; assignment: LessonAssignment; previousStatus: AssignmentStatus };

/**
 * Assignments (alocações) of members to lessons, as teacher or monitor: make one, list those of a
 * lesson, confirm and cancel one, and list those of a member (RF-047, RF-048, RF-049, RF-050).
 * Applications (`source` `application`), refusing one (`declined`) and the "my lessons" of the
 * member are another card (GUS-160).
 *
 * Every write runs in a transaction and the audit event goes out after the commit, only when
 * something changed. The lesson is read through `LessonsService` and the member through
 * `MembersService`: this module touches no table of another one. The note of an assignment is free
 * text and is never in an event (RNF-13).
 *
 * The two rules that two requests at the same time could break are held by partial unique indexes
 * (docs/ARCHITECTURE.md section 15): one active assignment per member in a lesson, and one
 * confirmed teacher per lesson. The pre-checks answer first, with the business error; the
 * violation of the index (23505) is mapped to the same one when a request races past them.
 *
 * Locks, always in this order, so no two writes wait for each other in a circle:
 * - making one: the lesson FOR SHARE, then the member FOR SHARE, then the insert;
 * - confirming one: the assignment FOR UPDATE, then the lesson FOR SHARE, then the member FOR SHARE,
 *   then the update;
 * - cancelling one: the assignment FOR UPDATE.
 * The FOR SHARE on the lesson conflicts with the FOR UPDATE that `LessonsService` takes to edit,
 * cancel or reschedule, so nobody is assigned to a lesson that was cancelled a moment before; the
 * FOR SHARE on the member conflicts with the FOR UPDATE that the change of access takes, so nobody
 * is assigned to a member whose access was disabled a moment before. Shared locks do not conflict
 * with each other, so two assignments to the same lesson, or of the same member, do not wait for one
 * another. `lessons` and `people` never lock an assignment, so there is no wait in a circle.
 */
@Injectable()
export class AssignmentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly clock: Clock,
    private readonly lessons: LessonsService,
    private readonly members: MembersService,
    private readonly people: PeopleService,
    private readonly policy: PermissionPolicy,
  ) {}

  /**
   * Assigns a member to a lesson, as teacher or monitor, `pending` or already `confirmed` (RF-047).
   * The assignment is `direct` and its author is the actor. With `confirmed`, `reviewedById` is the
   * actor and `reviewedAt` is now: whoever made it already confirmed is who decided it.
   *
   * Errors, in the order they are answered: 400 VALIDATION_FAILED (the DTO), 404 LESSON_NOT_FOUND,
   * 409 LESSON_CANCELLED (a cancelled lesson does not happen), 400 MEMBER_NOT_FOUND (the `personId`
   * is in the body, so it is not a 404; a student is not a member), 409 MEMBER_INACTIVE (no access,
   * or a registration that is still pending or was rejected), 409 DUPLICATE_ROLE_IN_LESSON (the
   * member already holds an active place in the lesson, as the same role or as the other one, RN-01)
   * and 409 LESSON_TEACHER_TAKEN (a teacher asked confirmed while the lesson already has a confirmed
   * one, RN-02). Several pending teachers are fine: they are candidates.
   *
   * The lesson and the member are locked FOR SHARE until the commit, so neither can be cancelled or
   * disabled between the checks and the insert. Past the pre-checks, the partial unique indexes have
   * the last word: their violations are mapped to the same two 409.
   *
   * Emits LESSON_ASSIGNMENT_CREATED after the commit, without the note.
   */
  async create(
    lessonId: string,
    dto: CreateAssignmentDto,
    actorId: string,
  ): Promise<LessonAssignmentResponseDto> {
    const now = this.clock.now();

    const created = await this.runInTransaction(async (manager) => {
      const lesson = await this.lessons.getLessonSummary(lessonId, manager, { forShare: true });
      if (lesson === null) throw lessonNotFound();
      if (lesson.status === LessonStatus.CANCELLED) throw lessonCancelled();

      const member = await this.members.getMemberSummary(dto.personId, manager, {
        forShare: true,
      });
      if (member === null) throw memberNotFoundInBody();
      if (!member.active) throw memberInactive();

      if (await this.hasActiveAssignment(manager, lesson.id, member.id)) {
        throw duplicateRoleInLesson();
      }
      const confirmed = dto.status === AssignmentStatus.CONFIRMED;
      if (
        confirmed &&
        dto.role === AssignmentRole.TEACHER &&
        (await this.hasConfirmedTeacher(manager, lesson.id))
      ) {
        throw lessonTeacherTaken();
      }

      const assignment = await manager.save(
        manager.create(LessonAssignment, {
          lessonId: lesson.id,
          personId: member.id,
          role: dto.role,
          status: dto.status,
          source: AssignmentSource.DIRECT,
          note: dto.note ?? null,
          createdById: actorId,
          reviewedById: confirmed ? actorId : null,
          reviewedAt: confirmed ? now : null,
          cancelledById: null,
          cancelledAt: null,
        }),
      );

      return { assignment, person: { id: member.id, name: member.name } };
    });

    const { assignment } = created;
    this.emit(AuditableAction.LESSON_ASSIGNMENT_CREATED, actorId, assignment.id, null, {
      lessonId: assignment.lessonId,
      personId: assignment.personId,
      role: assignment.role,
      status: assignment.status,
      source: assignment.source,
    });

    return toLessonAssignmentResponse(assignment, created.person);
  }

  /**
   * The assignments of a lesson, every status (a cancelled or declined one is history, and the
   * front tells them apart by `status`), each with the id and the name of the member. Ordered by
   * role (the teacher first), then by status in the order of the enum (pending, confirmed,
   * declined, cancelled), then by when it was made, then by id. Not paginated: a lesson has a few
   * people. 404 LESSON_NOT_FOUND for an id that is not a lesson.
   *
   * A plain read: no transaction, no lock and no event. The names come from ONE call to
   * `PeopleService.findRefsByIds`; a person that was removed is `person: null`.
   */
  async listByLesson(lessonId: string): Promise<LessonAssignmentResponseDto[]> {
    const lesson = await this.lessons.getLessonSummary(lessonId);
    if (lesson === null) throw lessonNotFound();

    const assignments = await this.dataSource.getRepository(LessonAssignment).find({
      where: { lessonId: lesson.id },
      order: { role: "ASC", status: "ASC", createdAt: "ASC", id: "ASC" },
    });
    if (assignments.length === 0) return [];

    const people = await this.people.findRefsByIds(
      assignments.map((assignment) => assignment.personId),
    );
    const peopleById = new Map(people.map((person) => [person.id, person]));

    return assignments.map((assignment) =>
      toLessonAssignmentResponse(assignment, peopleById.get(assignment.personId) ?? null),
    );
  }

  /**
   * Confirms a pending assignment: the member becomes staff of the lesson, and the coverage counts
   * her from now on (F5.4). Who confirms it and when go to `reviewedById` and `reviewedAt`. Refusing
   * a pending one is the review of the applications (GUS-160).
   *
   * Confirming an assignment that is already confirmed is a no-op that answers 200: no write and no
   * event, and the lesson and the member are not even looked at. Otherwise, errors, in the order
   * they are answered: 404 ASSIGNMENT_NOT_FOUND, 409 ASSIGNMENT_NOT_PENDING (a declined or cancelled
   * one is final), 409 LESSON_CANCELLED, 409 MEMBER_INACTIVE (her access was disabled while the
   * assignment waited) and 409 LESSON_TEACHER_TAKEN (another teacher was confirmed while this one
   * waited, RN-02).
   *
   * The assignment is locked FOR UPDATE until the commit, so two confirmations (or a confirmation
   * and a cancellation) of it are serialized; the lesson and the member are locked FOR SHARE after
   * it. Past the pre-check, the unique index of the confirmed teacher has the last word.
   *
   * Emits LESSON_ASSIGNMENT_CONFIRMED after the commit, only when it was confirmed now.
   */
  async confirm(assignmentId: string, actorId: string): Promise<LessonAssignmentResponseDto> {
    const now = this.clock.now();

    const outcome = await this.runInTransaction(async (manager): Promise<ConfirmOutcome> => {
      const assignment = await this.loadAssignment(manager, assignmentId);
      if (assignment.status === AssignmentStatus.CONFIRMED) return { changed: false, assignment };
      if (assignment.status !== AssignmentStatus.PENDING) throw assignmentNotPending();

      const lesson = await this.lessons.getLessonSummary(assignment.lessonId, manager, {
        forShare: true,
      });
      if (lesson === null) {
        throw new Error(
          `Lesson ${assignment.lessonId} of assignment ${assignment.id} was not found, but the foreign key requires it.`,
        );
      }
      if (lesson.status === LessonStatus.CANCELLED) throw lessonCancelled();

      const member = await this.members.getMemberSummary(assignment.personId, manager, {
        forShare: true,
      });
      // A person that is no longer a member (gone, or with neither role nor profile) cannot be
      // confirmed either: she is as inactive as one whose access was disabled.
      if (member === null || !member.active) throw memberInactive();

      if (
        assignment.role === AssignmentRole.TEACHER &&
        (await this.hasConfirmedTeacher(manager, assignment.lessonId))
      ) {
        throw lessonTeacherTaken();
      }

      assignment.status = AssignmentStatus.CONFIRMED;
      assignment.reviewedById = actorId;
      assignment.reviewedAt = now;
      // The instant of the confirmation is the one of the update, as in the cancellation of a
      // lesson. Left alone, the table would fill updated_at with its own CURRENT_TIMESTAMP.
      assignment.updatedAt = now;
      await manager.save(assignment);

      return { changed: true, assignment };
    });

    const { assignment } = outcome;
    if (outcome.changed) {
      this.emit(
        AuditableAction.LESSON_ASSIGNMENT_CONFIRMED,
        actorId,
        assignment.id,
        { status: AssignmentStatus.PENDING },
        {
          status: AssignmentStatus.CONFIRMED,
          reviewedAt: now,
          lessonId: assignment.lessonId,
          personId: assignment.personId,
          role: assignment.role,
        },
      );
    }

    return toLessonAssignmentResponse(assignment, await this.personRefOf(assignment.personId));
  }

  /**
   * Cancels an assignment that is pending or confirmed: status `cancelled`, with the instant and who
   * did it. The row stays (nothing is deleted), the member is free to be assigned to the lesson
   * again with a new assignment, and the coverage stops counting her. It has no body and no reason.
   * It is allowed for a cancelled lesson too: cancelling a lesson does not cancel its assignments.
   *
   * Cancelling an assignment that is already cancelled is a no-op that answers 200: no write and no
   * event, and the first instant stays. Otherwise, errors: 404 ASSIGNMENT_NOT_FOUND and 409
   * ASSIGNMENT_NOT_ACTIVE (a declined one was never in place).
   *
   * The assignment is locked FOR UPDATE until the commit, so two cancellations of it are serialized
   * and the second one finds it cancelled. `cancelledAt` and `updatedAt` are the same instant, read
   * once from the clock.
   *
   * Emits LESSON_ASSIGNMENT_CANCELLED after the commit, only when it was cancelled now.
   */
  async cancel(assignmentId: string, actorId: string): Promise<LessonAssignmentResponseDto> {
    const now = this.clock.now();

    const outcome = await this.runInTransaction(async (manager): Promise<CancelOutcome> => {
      const assignment = await this.loadAssignment(manager, assignmentId);
      if (assignment.status === AssignmentStatus.CANCELLED) return { changed: false, assignment };
      if (assignment.status === AssignmentStatus.DECLINED) throw assignmentNotActive();

      const previousStatus = assignment.status;
      assignment.status = AssignmentStatus.CANCELLED;
      assignment.cancelledAt = now;
      assignment.cancelledById = actorId;
      // The instant of the cancellation is the one of the update, as in the cancellation of a
      // lesson. Left alone, the table would fill updated_at with its own CURRENT_TIMESTAMP.
      assignment.updatedAt = now;
      await manager.save(assignment);

      return { changed: true, assignment, previousStatus };
    });

    const { assignment } = outcome;
    if (outcome.changed) {
      this.emit(
        AuditableAction.LESSON_ASSIGNMENT_CANCELLED,
        actorId,
        assignment.id,
        { status: outcome.previousStatus },
        {
          status: AssignmentStatus.CANCELLED,
          cancelledAt: now,
          lessonId: assignment.lessonId,
          personId: assignment.personId,
          role: assignment.role,
        },
      );
    }

    return toLessonAssignmentResponse(assignment, await this.personRefOf(assignment.personId));
  }

  /**
   * The assignments of a member, every status, each with the lesson it is for (id, title, day,
   * times and status of the lesson), the latest lesson first: by day, then by start time, both
   * descending, then the newest assignment first. Not paginated, and without the class or the
   * course of the lesson (they would need the other modules). The lessons come from ONE call to
   * `LessonsService.findLessonSummaries`.
   *
   * 404 MEMBER_NOT_FOUND for an id that is not a member: unknown, malformed, or a person with neither
   * an access role nor a member profile. That comes BEFORE the scope check. Scope (`members.view`):
   * coordination reads every member; a director only a member of the own department, otherwise 403
   * FORBIDDEN_SCOPE. The department of the TARGET is the one of the APPROVED profile (the same rule
   * as the member record), so a director without department is outside the scope of everybody.
   *
   * A plain read: no transaction, no lock and no event.
   */
  async listByMember(personId: string, actor: AuthUser): Promise<MemberAssignmentResponseDto[]> {
    const member = await this.members.getMemberSummary(personId);
    if (member === null) throw memberNotFound();

    this.policy.assertCan(actor, Permission.MEMBERS_VIEW, {
      personId: member.id,
      departmentIds: member.departmentIds,
    });

    const assignments = await this.dataSource
      .getRepository(LessonAssignment)
      .find({ where: { personId: member.id } });
    if (assignments.length === 0) return [];

    const summaries = await this.lessons.findLessonSummaries(
      assignments.map((assignment) => assignment.lessonId),
    );
    const lessonsById = new Map(summaries.map((lesson) => [lesson.id, lesson]));

    // An assignment whose lesson is gone (a lesson is never deleted, so this is a row of the past
    // that the lessons no longer answer for) has nothing to show, and is left out.
    return assignments
      .flatMap((assignment) => {
        const lesson = lessonsById.get(assignment.lessonId);
        return lesson === undefined ? [] : [{ assignment, lesson }];
      })
      .sort(
        (a, b) =>
          b.lesson.date.localeCompare(a.lesson.date) ||
          b.lesson.startTime.localeCompare(a.lesson.startTime) ||
          b.assignment.createdAt.getTime() - a.assignment.createdAt.getTime() ||
          a.assignment.id.localeCompare(b.assignment.id),
      )
      .map(({ assignment, lesson }) => toMemberAssignmentResponse(assignment, lesson));
  }

  /**
   * Runs the work in a transaction and turns the constraint violations that mean a business error
   * into it: a second active assignment of the member in the lesson and a second confirmed teacher
   * (409, which the pre-checks normally answer first, but two requests at the same time pass them
   * together), and a member or a lesson that does not exist (which the lookups with a lock normally
   * answer first). They are the safety net, in case the rows move under the checks.
   */
  private async runInTransaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    try {
      return await this.dataSource.transaction(work);
    } catch (error) {
      throw this.mapConstraintError(error);
    }
  }

  /** The assignment, locked FOR UPDATE until the end of the transaction. */
  private async loadAssignment(manager: EntityManager, id: string): Promise<LessonAssignment> {
    const assignment = await manager.findOne(LessonAssignment, {
      where: { id },
      lock: { mode: "pessimistic_write" },
    });
    if (assignment === null) throw assignmentNotFound();

    return assignment;
  }

  /** Whether the member holds a place in the lesson: a pending or confirmed assignment of hers. */
  private hasActiveAssignment(
    manager: EntityManager,
    lessonId: string,
    personId: string,
  ): Promise<boolean> {
    return manager.exists(LessonAssignment, {
      where: { lessonId, personId, status: In(ACTIVE_ASSIGNMENT_STATUSES) },
    });
  }

  /** Whether the lesson already has a confirmed teacher. */
  private hasConfirmedTeacher(manager: EntityManager, lessonId: string): Promise<boolean> {
    return manager.exists(LessonAssignment, {
      where: { lessonId, role: AssignmentRole.TEACHER, status: AssignmentStatus.CONFIRMED },
    });
  }

  /**
   * The id and the name of the member of an assignment, read after the transaction has ended: it is
   * the contract of `PeopleService.findRefsByIds`, which takes no `manager`, and a read of another
   * connection must not wait inside a transaction that holds one. Null when the person is gone.
   */
  private async personRefOf(personId: string): Promise<PersonRefDto | null> {
    const [person] = await this.people.findRefsByIds([personId]);
    return person ?? null;
  }

  /** Turns the violations of the constraints of `lesson_assignments` into their business error. */
  private mapConstraintError(error: unknown): unknown {
    if (error instanceof QueryFailedError) {
      const driverError = error.driverError as { code?: string; constraint?: string } | undefined;

      if (driverError?.code === "23505" && driverError.constraint === ACTIVE_UNIQUE_INDEX) {
        return duplicateRoleInLesson();
      }
      if (
        driverError?.code === "23505" &&
        driverError.constraint === CONFIRMED_TEACHER_UNIQUE_INDEX
      ) {
        return lessonTeacherTaken();
      }
      if (driverError?.code === "23503" && driverError.constraint === PERSON_FOREIGN_KEY) {
        return memberNotFoundInBody();
      }
      if (driverError?.code === "23503" && driverError.constraint === LESSON_FOREIGN_KEY) {
        return lessonNotFound();
      }
    }
    return error;
  }

  private emit(
    action: AuditableAction,
    actorId: string,
    targetId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
  ): void {
    const event = new AuditableActionEvent();
    event.actorId = actorId;
    event.action = action;
    event.targetType = ASSIGNMENT_TARGET_TYPE;
    event.targetId = targetId;
    event.before = before;
    event.after = after;
    event.occurredAt = this.clock.now();
    this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, event);
  }
}
