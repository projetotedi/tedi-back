import { Injectable } from "@nestjs/common";
import { DataSource, In } from "typeorm";
import { ConfirmedStaffCount, NO_CONFIRMED_STAFF } from "@modules/lessons/services/lesson-coverage";
import {
  LessonAgendaRef,
  LessonListingService,
} from "@modules/lessons/services/lesson-listing.service";
import { todayInAppTimeZone } from "@shared/dates/calendar-date";
import { Clock } from "@shared/dates/clock";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { MyAssignmentsResponseDto } from "../dto/my-assignments.response.dto";
import { MyLessonsPeriodQueryDto } from "../dto/my-lessons-period-query.dto";
import { OpenLessonResponseDto } from "../dto/open-lesson.response.dto";
import { LessonAssignment } from "../entities/lesson-assignment.entity";
import { ACTIVE_ASSIGNMENT_STATUSES, AssignmentStatus } from "../enums/assignment-status.enum";
import { toMyAssignmentResponse, toOpenLessonResponse } from "./assignment-response.mapper";
import { LessonStaffCounterService } from "./lesson-staff-counter.service";
import { resolveMyLessonsPeriod } from "./my-lessons-period";
import { isClosedForApplications, openRolesOf } from "./role-vacancy";

/** The statuses that hold the place of the member in a lesson: the predicate of the active index. */
const PLACE_HOLDING_STATUSES: ReadonlySet<AssignmentStatus> = new Set(ACTIVE_ASSIGNMENT_STATUSES);

/** A lesson of the agenda with its confirmed staff, counted once for the lessons it is asked for. */
interface StaffedLesson {
  ref: LessonAgendaRef;
  staff: ConfirmedStaffCount;
}

/** Whether the assignment holds the place of the member in its lesson (pending or confirmed). */
function holdsPlace(assignment: LessonAssignment | undefined): boolean {
  return assignment !== undefined && PLACE_HOLDING_STATUSES.has(assignment.status);
}

/**
 * The agenda of the member of the session (F5.5, GUS-160): "Minhas aulas", the lessons where she is
 * assigned or applied, and the lessons with an open place for her. Both are `/me/*` routes: the
 * person is the one of the session, filtered by her id in the query, and the `PermissionPolicy` is
 * never asked (its scope `all` would give the superadmin anyone's lessons, H4).
 *
 * Both take the same period (`resolveMyLessonsPeriod`: today and four weeks by default, at most 42
 * days) and read the lessons that will happen in it through `LessonListingService.findAgendaBetween`
 * (not cancelled, of classes that are not archived). Neither carries the note of an assignment.
 *
 * Plain reads: no transaction, no lock, no event. Each call costs a fixed number of queries,
 * whatever the number of lessons: the agenda (classes and lessons), the assignments of the member in
 * those lessons, and the confirmed staff of the lessons that could have an open place for her
 * (skipped when none is left).
 */
@Injectable()
export class MyAssignmentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: Clock,
    private readonly listing: LessonListingService,
    private readonly staffCounter: LessonStaffCounterService,
  ) {}

  /**
   * "Minhas aulas": one item per lesson of the period where the member has an assignment, with the
   * latest status of hers in it (the active one when there is one, else the latest declined or
   * cancelled, so a declined application shows as declined and a new application replaces it), the
   * soonest lesson first. The totals of the top of the screen, every key always present:
   * `upcoming` (pending plus confirmed), `confirmed`, `pending` and `openLessons`, the number of
   * lessons `listOpen` answers for the same period, counted by the same rule. Declined and cancelled
   * items are listed and counted in no total.
   *
   * 400 INVALID_DATE_RANGE and 400 DATE_RANGE_TOO_LONG come before anything is read.
   */
  async listMine(
    actor: AuthUser,
    query: MyLessonsPeriodQueryDto,
  ): Promise<MyAssignmentsResponseDto> {
    const today = todayInAppTimeZone(this.clock.now());
    const period = resolveMyLessonsPeriod(query, today);

    const agenda = await this.listing.findAgendaBetween(period.from, period.to);
    const latest = await this.latestAssignmentsByLesson(actor.id, agenda);

    const items = agenda.flatMap((ref) => {
      const assignment = latest.get(ref.id);
      return assignment === undefined ? [] : [toMyAssignmentResponse(assignment, ref)];
    });
    const open = await this.openLessonsOf(agenda, latest, today);

    const confirmed = items.filter((item) => item.status === AssignmentStatus.CONFIRMED).length;
    const pending = items.filter((item) => item.status === AssignmentStatus.PENDING).length;

    return {
      from: period.from,
      to: period.to,
      totals: { upcoming: confirmed + pending, confirmed, pending, openLessons: open.length },
      items,
    };
  }

  /**
   * The lessons with an open place for the member ("Aulas com vaga para você"): the lessons of the
   * period that still take applications (`isClosedForApplications`: from today on and not done, even
   * when `from` is before today), where she holds no place (a declined application or a cancelled assignment does
   * not keep the lesson out) and that have an open place for some role (`openRolesOf`, the rule
   * `applyToLesson` checks). Each with its coverage and its open roles, the soonest lesson first.
   * Not paginated: its length is `totals.openLessons` of "Minhas aulas" for the same period.
   *
   * 400 INVALID_DATE_RANGE and 400 DATE_RANGE_TOO_LONG come before anything is read.
   */
  async listOpen(
    actor: AuthUser,
    query: MyLessonsPeriodQueryDto,
  ): Promise<OpenLessonResponseDto[]> {
    const today = todayInAppTimeZone(this.clock.now());
    const period = resolveMyLessonsPeriod(query, today);

    const agenda = await this.listing.findAgendaBetween(period.from, period.to);
    const latest = await this.latestAssignmentsByLesson(actor.id, agenda);
    const open = await this.openLessonsOf(agenda, latest, today);

    return open.map(({ ref, staff }) => toOpenLessonResponse(ref, staff));
  }

  /**
   * The latest assignment of the person in each lesson of the agenda, in ONE query by her id and the
   * ids of those lessons: the one that holds her place when there is one (at most one, by the active
   * index), else the newest one (by `createdAt`, then id). A soft-deleted row is left out by `find`.
   * An empty agenda asks nothing.
   */
  private async latestAssignmentsByLesson(
    personId: string,
    agenda: readonly LessonAgendaRef[],
  ): Promise<Map<string, LessonAssignment>> {
    if (agenda.length === 0) return new Map();

    const rows = await this.dataSource.getRepository(LessonAssignment).find({
      where: { personId, lessonId: In(agenda.map((ref) => ref.id)) },
      order: { createdAt: "DESC", id: "DESC" },
    });

    const latest = new Map<string, LessonAssignment>();
    for (const row of rows) {
      const current = latest.get(row.lessonId);
      if (current === undefined || (!holdsPlace(current) && holdsPlace(row))) {
        latest.set(row.lessonId, row);
      }
    }
    return latest;
  }

  /**
   * The ONE definition of "a lesson with an open place for you", shared by the list and by the total
   * of "Minhas aulas": the lessons that still take applications (the rule `applyToLesson` checks
   * with LESSON_IN_PAST) where the member holds no place, with the
   * confirmed staff counted ONCE for all of them, kept when `openRolesOf` is not empty. With no
   * candidate left it counts nothing.
   */
  private async openLessonsOf(
    agenda: readonly LessonAgendaRef[],
    latest: ReadonlyMap<string, LessonAssignment>,
    today: string,
  ): Promise<StaffedLesson[]> {
    const candidates = agenda.filter(
      (ref) => !isClosedForApplications(ref, today) && !holdsPlace(latest.get(ref.id)),
    );
    if (candidates.length === 0) return [];

    const staff = await this.staffCounter.countConfirmedStaff(candidates.map((ref) => ref.id));

    return candidates
      .map((ref) => ({ ref, staff: staff.get(ref.id) ?? NO_CONFIRMED_STAFF }))
      .filter(({ ref, staff: counts }) => openRolesOf(ref, counts).length > 0);
  }
}
