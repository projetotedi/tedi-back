import { Injectable } from "@nestjs/common";
import { isUUID } from "class-validator";
import { DataSource, EntityManager } from "typeorm";
import { APP_TIME_ZONE, isValidCalendarDate } from "@shared/dates/calendar-date";
import { EnrollmentStatus } from "../enums/enrollment-status.enum";

/** An enrollment of the roll call of a lesson, with its status as of today. */
export interface RosterEnrollment {
  id: string;
  studentId: string;
  status: EnrollmentStatus;
  /** "YYYY-MM-DD": from when `status` holds (section 19, M4). */
  statusChangedAt: string;
}

/** A class on a day ("YYYY-MM-DD"): what the lessons of that class on that day expect. */
export interface RosterSlot {
  classId: string;
  date: string;
}

/** One enrollment a slot expects. */
export interface RosterSlotEnrollment {
  classId: string;
  date: string;
  enrollmentId: string;
}

/**
 * The predicate "expected at the lesson of the class on `day`" of the enrollment `e`, the ONE place
 * of the rule (GUS-166, S2): not removed, enrolled on or before that day in `zone`, and either
 * active or dropped/completed only after that day. `statusChangedAt` is "from when" (M4), so on
 * that very day the student is already out. `day` and `zone` are SQL expressions (a parameter or a
 * column), never values.
 */
function expectedOnDay(day: string, zone: string): string {
  return `e.deleted_at IS NULL
          AND (e.enrolled_at AT TIME ZONE ${zone})::date <= ${day}
          AND (e.status = 'active' OR ${day} < e.status_changed_at)`;
}

/**
 * Who the roll call of a lesson is made of, for the attendance (GUS-166, docs/ARCHITECTURE.md section
 * 18.1): the enrollments the class expects on the day of the lesson, read by the rule of
 * `expectedOnDay`, which lives only here.
 *
 * Neither read takes a lock. Whoever needs the answer to hold until the end of a transaction locks
 * the class FOR SHARE first (`ClassesService.getClassSummary` with `forShare`): every write of an
 * enrollment locks its class FOR UPDATE before touching it, so while the class is held no enrollment
 * of it changes. Every `date` read raw comes out `::text`, so it stays "YYYY-MM-DD" (M10: the driver
 * would make it a Date at midnight of the server, which can be the day before).
 */
@Injectable()
export class EnrollmentRosterService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * The enrollments of the roll call of a lesson of the class `classId` on `date`: the ones the day
   * expects, plus the ones in `includeIds` (the enrollments with an attendance signed in the lesson),
   * whatever their status today and removed or not, so a signature always finds its enrollment. By
   * student, then by id. A `classId` that is not a UUID answers [] without querying; a `date` that
   * is not a calendar day is a broken invariant (it comes from a lesson) and throws.
   */
  async findRoster(
    classId: string,
    date: string,
    options: { includeIds?: readonly string[] } = {},
    manager?: EntityManager,
  ): Promise<RosterEnrollment[]> {
    if (!isUUID(classId)) return [];
    if (!isValidCalendarDate(date)) {
      throw new Error(`The day of a roll call must be a calendar date, got "${date}".`);
    }
    const includeIds = [
      ...new Set(
        (options.includeIds ?? []).filter((id) => isUUID(id)).map((id) => id.toLowerCase()),
      ),
    ];

    return (manager ?? this.dataSource.manager).query(
      `SELECT e.id AS "id", e.student_id AS "studentId", e.status AS "status",
              e.status_changed_at::text AS "statusChangedAt"
         FROM enrollments e
        WHERE e.class_id = $1
          AND ((${expectedOnDay("$2::date", "$3::text")}) OR e.id = ANY($4::uuid[]))
        ORDER BY e.student_id, e.id`,
      [classId, date, APP_TIME_ZONE, includeIds],
    );
  }

  /**
   * The ids of the enrollments each slot expects, in ONE query for every slot (the roll calls of a
   * page of lessons). Only the expected ones: the signed ones are the caller's. A slot whose class is
   * not a UUID or whose day is not a calendar date is skipped, and a repeated pair is asked once;
   * with nothing to ask it answers [] without querying.
   */
  async findRosterIds(
    slots: readonly RosterSlot[],
    manager?: EntityManager,
  ): Promise<RosterSlotEnrollment[]> {
    const unique = new Map<string, RosterSlot>();
    for (const slot of slots) {
      if (!isUUID(slot.classId) || !isValidCalendarDate(slot.date)) continue;
      const classId = slot.classId.toLowerCase();
      unique.set(`${classId}|${slot.date}`, { classId, date: slot.date });
    }
    if (unique.size === 0) return [];

    const asked = [...unique.values()];
    return (manager ?? this.dataSource.manager).query(
      `SELECT s.class_id AS "classId", s.day::text AS "date", e.id AS "enrollmentId"
         FROM unnest($1::uuid[], $2::date[]) AS s(class_id, day)
         JOIN enrollments e ON e.class_id = s.class_id
          AND ${expectedOnDay("s.day", "$3::text")}`,
      [asked.map((slot) => slot.classId), asked.map((slot) => slot.date), APP_TIME_ZONE],
    );
  }
}

// The enum of the contract of `findRoster`, and its description, re-exported so that the attendance
// imports them from the service ClassesModule exports and never from `classes/enums/*`.
export { EnrollmentStatus, ENROLLMENT_STATUS_DESCRIPTION } from "../enums/enrollment-status.enum";
