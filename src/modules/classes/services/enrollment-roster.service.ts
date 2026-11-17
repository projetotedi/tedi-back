import { Injectable } from "@nestjs/common";
import { isUUID } from "class-validator";
import { DataSource, EntityManager } from "typeorm";
import { APP_TIME_ZONE, isValidCalendarDate } from "@shared/dates/calendar-date";
import { isValidTimeOfDay } from "@shared/dates/time-of-day";
import { EnrollmentStatus } from "../enums/enrollment-status.enum";

/** An enrollment of the roll call of a lesson, with its status as of today. */
export interface RosterEnrollment {
  id: string;
  studentId: string;
  status: EnrollmentStatus;
  /** "YYYY-MM-DD": from when `status` holds (section 19, M4). */
  statusChangedAt: string;
}

/**
 * A lesson as the roll call sees it: its class, its day ("YYYY-MM-DD") and the time it ends
 * ("HH:mm", in America/Sao_Paulo). Two lessons of the same class, day and end expect the same
 * enrollments.
 */
export interface RosterSlot {
  classId: string;
  date: string;
  endTime: string;
}

/** One enrollment a slot expects. */
export interface RosterSlotEnrollment {
  classId: string;
  date: string;
  endTime: string;
  enrollmentId: string;
}

/**
 * The predicate "expected at the lesson of the class on `day`, ending at `endTime`" of the
 * enrollment `e`, the ONE place of the rule (GUS-166, S2):
 * - not removed;
 * - enrolled before the lesson ended (the instant, in `zone`): an enrollment made later that same
 *   day does not reopen a roll call that was already closed;
 * - and in the status it has now on that day: `statusChangedAt` is "from when" the status holds
 *   (M4, a day), so an active enrollment is expected from that day on (a reactivation does not reach
 *   back into the lessons before it), and a dropped or completed one only before that day.
 * The enrollment of the POST records `statusChangedAt` = its own day, so an enrollment that never
 * changed is expected from the day it was made. `day`, `endTime` and `zone` are SQL expressions (a
 * parameter or a column), never values.
 */
function expectedAt(day: string, endTime: string, zone: string): string {
  return `e.deleted_at IS NULL
          AND e.enrolled_at < ((${day} + ${endTime}) AT TIME ZONE ${zone})
          AND ((e.status = 'active' AND ${day} >= e.status_changed_at)
               OR (e.status <> 'active' AND ${day} < e.status_changed_at))`;
}

/**
 * Who the roll call of a lesson is made of, for the attendance (GUS-166, docs/ARCHITECTURE.md section
 * 18.1): the enrollments the class expects at the lesson, read by the rule of `expectedAt`, which
 * lives only here.
 *
 * Neither read takes a lock. Whoever needs the answer to hold until the end of a transaction locks
 * the class FOR SHARE first (`ClassesService.getClassSummary` with `forShare`): every write of an
 * enrollment locks its class FOR UPDATE before touching it, so while the class is held no enrollment
 * of it changes. Every `date` read raw comes out `::text`, so it stays "YYYY-MM-DD" (M10: the driver
 * would make it a Date at midnight of the server, which can be the day before), and every `time`
 * comes out "HH:mm".
 */
@Injectable()
export class EnrollmentRosterService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * The enrollments of the roll call of a lesson (`slot`: its class, day and end): the ones the
   * lesson expects, plus the ones in `includeIds` (the enrollments with an attendance signed in the
   * lesson), whatever their status today and removed or not, so a signature always finds its
   * enrollment. By student, then by id. A `classId` that is not a UUID, or a `date` or an `endTime`
   * that is not valid, is a broken invariant (they all come from a lesson) and throws.
   */
  async findRoster(
    slot: RosterSlot,
    options: { includeIds?: readonly string[] } = {},
    manager?: EntityManager,
  ): Promise<RosterEnrollment[]> {
    if (!isUUID(slot.classId)) {
      throw new Error(`The class of a roll call must be a uuid, got "${slot.classId}".`);
    }
    if (!isValidCalendarDate(slot.date) || !isValidTimeOfDay(slot.endTime)) {
      throw new Error(
        `The lesson of a roll call must have a calendar date and an end time, got "${slot.date}" and "${slot.endTime}".`,
      );
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
          AND ((${expectedAt("$2::date", "$3::time", "$4::text")}) OR e.id = ANY($5::uuid[]))
        ORDER BY e.student_id, e.id`,
      [slot.classId, slot.date, slot.endTime, APP_TIME_ZONE, includeIds],
    );
  }

  /**
   * The ids of the enrollments each slot expects, in ONE query for every slot (the roll calls of a
   * page of lessons). Only the expected ones: the signed ones are the caller's. A slot whose class is
   * not a UUID, or whose day or end is not valid, is skipped, and a repeated slot is asked once; with
   * nothing to ask it answers [] without querying.
   */
  async findRosterIds(
    slots: readonly RosterSlot[],
    manager?: EntityManager,
  ): Promise<RosterSlotEnrollment[]> {
    const unique = new Map<string, RosterSlot>();
    for (const slot of slots) {
      if (
        !isUUID(slot.classId) ||
        !isValidCalendarDate(slot.date) ||
        !isValidTimeOfDay(slot.endTime)
      ) {
        continue;
      }
      const classId = slot.classId.toLowerCase();
      unique.set(`${classId}|${slot.date}|${slot.endTime}`, {
        classId,
        date: slot.date,
        endTime: slot.endTime,
      });
    }
    if (unique.size === 0) return [];

    const asked = [...unique.values()];
    return (manager ?? this.dataSource.manager).query(
      `SELECT s.class_id AS "classId", s.day::text AS "date",
              to_char(s.end_time, 'HH24:MI') AS "endTime", e.id AS "enrollmentId"
         FROM unnest($1::uuid[], $2::date[], $3::time[]) AS s(class_id, day, end_time)
         JOIN enrollments e ON e.class_id = s.class_id
          AND ${expectedAt("s.day", "s.end_time", "$4::text")}`,
      [
        asked.map((slot) => slot.classId),
        asked.map((slot) => slot.date),
        asked.map((slot) => slot.endTime),
        APP_TIME_ZONE,
      ],
    );
  }
}

// The enum of the contract of `findRoster`, and its description, re-exported so that the attendance
// imports them from the service ClassesModule exports and never from `classes/enums/*`.
export { EnrollmentStatus, ENROLLMENT_STATUS_DESCRIPTION } from "../enums/enrollment-status.enum";
