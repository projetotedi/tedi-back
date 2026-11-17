import { Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource, EntityManager, In } from "typeorm";
import {
  EnrollmentRosterService,
  RosterEnrollment,
  RosterSlot,
} from "@modules/classes/services/enrollment-roster.service";
import {
  LessonsService,
  LessonStatus,
  LessonSummary,
} from "@modules/lessons/services/lessons.service";
import { PeopleService } from "@modules/people/services/people.service";
import { todayInAppTimeZone } from "@shared/dates/calendar-date";
import { Clock } from "@shared/dates/clock";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { AUDITABLE_ACTION_EVENT } from "@shared/events/auditable-action.event";
import { SignStudentAttendanceDto } from "../dto/sign-student-attendance.dto";
import { StudentRollCallItemResponseDto } from "../dto/student-roll-call-item.response.dto";
import { AttendanceCorrection } from "../entities/attendance-correction.entity";
import { StudentAttendance } from "../entities/student-attendance.entity";
import { StudentAttendanceStatus } from "../enums/student-attendance-status.enum";
import {
  duplicateEnrollment,
  enrollmentNotInRollCall,
  lessonCancelled,
  lessonInFuture,
  lessonNotFound,
  studentAttendanceAlreadySigned,
} from "./attendance-errors";
import { signedAuditOf } from "./student-attendance-audit";
import { compareRollCallItems, toStudentRollCallItem } from "./student-attendance-response.mapper";
import { StudentRollCallGuard } from "./student-roll-call.guard";

/** An entry of the body, with the id in lower case: the pipe of the DTO accepts upper case. */
interface RequestedEntry {
  enrollmentId: string;
  status: StudentAttendanceStatus;
}

/** The lesson as the roster takes it: its class, its day and its end. */
function rosterSlotOf(lesson: LessonSummary): RosterSlot {
  return { classId: lesson.classId, date: lesson.date, endTime: lesson.endTime };
}

/** The position of an entry of the body, as the field of `details`. */
function fieldOf(index: number): string {
  return `entries.${index}.enrollmentId`;
}

/** The positions of the entries whose enrollment repeats an earlier one of the body. */
function repeatedPositions(entries: readonly RequestedEntry[]): string[] {
  const seen = new Set<string>();
  return entries.flatMap((entry, index) => {
    if (seen.has(entry.enrollmentId)) return [fieldOf(index)];
    seen.add(entry.enrollmentId);
    return [];
  });
}

/** The corrections of the rows, by row. */
function correctionsByRowOf(
  corrections: readonly AttendanceCorrection[],
): Map<string, AttendanceCorrection[]> {
  const byRow = new Map<string, AttendanceCorrection[]>();
  for (const correction of corrections) {
    const list = byRow.get(correction.studentAttendanceId);
    if (list === undefined) byRow.set(correction.studentAttendanceId, [correction]);
    else list.push(correction);
  }
  return byRow;
}

/**
 * The roll call of the students of a lesson (F6.1, GUS-166, docs/ARCHITECTURE.md section 18.1): who
 * the lesson expects, their attendance, and the batch that signs it.
 *
 * Who is in the roll call comes from `EnrollmentRosterService` (the enrollments the lesson expects:
 * made before it ended and in force on its day; plus the ones already signed in it); the lesson from `LessonsService`, the
 * class and the confirmed staff through the `StudentRollCallGuard`, and the names from
 * `PeopleService`: this module touches no table of another one. The batch runs in one transaction,
 * with one `now` from the Clock, and its audit events go out after the commit, only for what was
 * written. Students generate no hours and the roll call never marks the lesson `done` (S17).
 */
@Injectable()
export class StudentRollCallService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly clock: Clock,
    private readonly lessons: LessonsService,
    private readonly roster: EnrollmentRosterService,
    private readonly people: PeopleService,
    private readonly guard: StudentRollCallGuard,
  ) {}

  /**
   * `GET /lessons/:id/attendance/students`: the roll call of the lesson, by the name of the student.
   * 404 LESSON_NOT_FOUND for an id that is not a lesson; a cancelled lesson, one in the future and
   * one of an archived class are read the same way. The justification and the reasons of the
   * corrections go out only to whoever takes the roll call of THIS lesson, decided once (S7). A
   * plain read: no transaction, no lock and no event.
   */
  async list(
    requestedLessonId: string,
    actor: AuthUser,
  ): Promise<StudentRollCallItemResponseDto[]> {
    const lesson = await this.lessons.getLessonSummary(requestedLessonId);
    if (lesson === null) throw lessonNotFound();

    const canSeeNotes = await this.guard.canTake(actor, lesson.id);
    return this.readRollCall(lesson, canSeeNotes);
  }

  /**
   * `PUT /lessons/:id/attendance/students`: signs the attendance of enrollments of the roll call of
   * the lesson, all or none, and answers the roll call read after the commit.
   *
   * The first signature of an enrollment writes it, with the actor and one instant; the same status
   * again is a no-op (no write, no event); the other status is 409 STUDENT_ATTENDANCE_ALREADY_SIGNED,
   * because changing a signed attendance is the correction, with a reason and a history (S4).
   *
   * Errors, in the order they are answered: 400 DUPLICATE_ENROLLMENT (before the transaction), 404
   * LESSON_NOT_FOUND, 409 LESSON_CANCELLED, 409 LESSON_IN_FUTURE (after today in APP_TIME_ZONE;
   * today is fine), 409 CLASS_ARCHIVED, 403 FORBIDDEN_SCOPE (a member who is not the confirmed
   * teacher or a confirmed monitor of the lesson), 400 ENROLLMENT_NOT_IN_ROLL_CALL and 409
   * STUDENT_ATTENDANCE_ALREADY_SIGNED, both with the positions. Every check comes before the write.
   *
   * Locks, in this order (S3): the lesson FOR SHARE, the class FOR SHARE, the advisory lock of the
   * roll call of the lesson, the confirmed assignments FOR SHARE; then the signatures and the roster
   * are read without a lock (the class held FOR SHARE keeps the enrollments still, and the advisory
   * lock keeps the signatures of the lesson still), and the first signatures go in ONE insert.
   *
   * Emits STUDENT_ATTENDANCE_SIGNED per new signature after the commit, in the order of the body.
   */
  async sign(
    requestedLessonId: string,
    dto: SignStudentAttendanceDto,
    actor: AuthUser,
  ): Promise<StudentRollCallItemResponseDto[]> {
    const requested: RequestedEntry[] = dto.entries.map((entry) => ({
      enrollmentId: entry.enrollmentId.toLowerCase(),
      status: entry.status,
    }));
    const repeated = repeatedPositions(requested);
    if (repeated.length > 0) throw duplicateEnrollment(repeated);

    const now = this.clock.now();

    const outcome = await this.dataSource.transaction(async (manager) => {
      const lesson = await this.lessons.getLessonSummary(requestedLessonId, manager, {
        forShare: true,
      });
      if (lesson === null) throw lessonNotFound();
      if (lesson.status === LessonStatus.CANCELLED) throw lessonCancelled();
      if (lesson.date > todayInAppTimeZone(now)) throw lessonInFuture();

      await this.guard.lockClassAndRollCall(manager, lesson);
      await this.guard.assertCanTake(actor, lesson.id, manager);

      const firsts = await this.firstSignaturesOf(manager, lesson, requested);
      // No write before this line: the batch is all or none.
      const inserted =
        firsts.length === 0
          ? []
          : await manager.save(
              StudentAttendance,
              firsts.map((entry) =>
                manager.create(StudentAttendance, {
                  lessonId: lesson.id,
                  enrollmentId: entry.enrollmentId,
                  status: entry.status,
                  signedById: actor.id,
                  signedAt: now,
                  createdAt: now,
                  updatedAt: now,
                }),
              ),
            );

      return { lesson, inserted };
    });

    for (const row of outcome.inserted) {
      this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, signedAuditOf(row, actor.id, now));
    }
    // The actor passed assertCan for this lesson: she takes its roll call.
    return this.readRollCall(outcome.lesson, true);
  }

  /**
   * The entries of the batch that are first signatures, in the order of the body, after the checks
   * of the roll call: every enrollment must be in it (400 ENROLLMENT_NOT_IN_ROLL_CALL) and none may be
   * signed with the other status (409 STUDENT_ATTENDANCE_ALREADY_SIGNED). The signatures are read
   * after the advisory lock, in a new command: a batch that waited for another one sees what it
   * committed, so it becomes a no-op or a 409, never a 23505.
   */
  private async firstSignaturesOf(
    manager: EntityManager,
    lesson: LessonSummary,
    requested: readonly RequestedEntry[],
  ): Promise<RequestedEntry[]> {
    const signed = await manager.find(StudentAttendance, { where: { lessonId: lesson.id } });
    const roster = await this.roster.findRoster(
      rosterSlotOf(lesson),
      { includeIds: signed.map((row) => row.enrollmentId) },
      manager,
    );

    const inRollCall = new Set(roster.map((enrollment) => enrollment.id));
    const outside = requested.flatMap((entry, index) =>
      inRollCall.has(entry.enrollmentId) ? [] : [fieldOf(index)],
    );
    if (outside.length > 0) throw enrollmentNotInRollCall(outside);

    const signedByEnrollment = new Map(signed.map((row) => [row.enrollmentId, row]));
    const conflicts: string[] = [];
    const firsts: RequestedEntry[] = [];
    requested.forEach((entry, index) => {
      const row = signedByEnrollment.get(entry.enrollmentId);
      if (row === undefined) firsts.push(entry);
      else if (row.status !== entry.status) conflicts.push(fieldOf(index));
    });
    if (conflicts.length > 0) throw studentAttendanceAlreadySigned(conflicts);

    return firsts;
  }

  /**
   * The roll call of a lesson in four queries however many students it has, plus ONE call to
   * `PeopleService.findRefsByIds`: the signatures of the lesson, the roster of its day with the
   * signed enrollments included, the corrections of the signatures (one `IN`, none without a
   * signature) and the names of the students, the signers, the justifiers and the correctors.
   *
   * A signature whose enrollment the roster did not bring is a broken invariant (the roster always
   * includes the signed ones, and the foreign key keeps the enrollment): it throws instead of
   * answering a roll call without it.
   */
  private async readRollCall(
    lesson: LessonSummary,
    canSeeNotes: boolean,
  ): Promise<StudentRollCallItemResponseDto[]> {
    const rows = await this.dataSource
      .getRepository(StudentAttendance)
      .find({ where: { lessonId: lesson.id } });
    const roster = await this.roster.findRoster(rosterSlotOf(lesson), {
      includeIds: rows.map((row) => row.enrollmentId),
    });
    const corrections = await this.findCorrections(rows.map((row) => row.id));

    this.assertEverySignatureInRoster(rows, roster);

    const people = await this.people.findRefsByIds([
      ...roster.map((enrollment) => enrollment.studentId),
      ...rows.map((row) => row.signedById),
      ...rows.flatMap((row) => (row.justifiedById === null ? [] : [row.justifiedById])),
      ...corrections.map((correction) => correction.correctedById),
    ]);
    const peopleById = new Map(people.map((person) => [person.id, person]));
    const rowsByEnrollment = new Map(rows.map((row) => [row.enrollmentId, row]));
    const correctionsByRow = correctionsByRowOf(corrections);

    return roster
      .map((enrollment) =>
        toStudentRollCallItem(
          enrollment,
          rowsByEnrollment.get(enrollment.id) ?? null,
          correctionsByRow,
          peopleById,
          { canSeeNotes },
        ),
      )
      .sort(compareRollCallItems);
  }

  /** The corrections of the rows, the oldest first, in ONE query; no row, no query. */
  private async findCorrections(rowIds: readonly string[]): Promise<AttendanceCorrection[]> {
    if (rowIds.length === 0) return [];

    return this.dataSource.getRepository(AttendanceCorrection).find({
      where: { studentAttendanceId: In([...rowIds]) },
      order: { createdAt: "ASC", id: "ASC" },
    });
  }

  private assertEverySignatureInRoster(
    rows: readonly StudentAttendance[],
    roster: readonly RosterEnrollment[],
  ): void {
    const inRoster = new Set(roster.map((enrollment) => enrollment.id));
    for (const row of rows) {
      if (!inRoster.has(row.enrollmentId)) {
        throw new Error(
          `The attendance ${row.id} points to the enrollment ${row.enrollmentId}, which the roll call did not bring.`,
        );
      }
    }
  }
}
