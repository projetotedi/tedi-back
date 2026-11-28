import { LessonStatus, LessonSummary } from "@modules/lessons/services/lessons.service";
import { LessonAssignment } from "../entities/lesson-assignment.entity";
import { AssignmentSource } from "../enums/assignment-source.enum";
import { AssignmentStatus } from "../enums/assignment-status.enum";

/** What the expiry of an application looks at in its lesson. */
export type ExpiryLesson = Pick<LessonSummary, "status" | "date">;

/** What the expiry of an application looks at in it. */
export type ExpiryAssignment = Pick<LessonAssignment, "status" | "source">;

/**
 * Whether a pending application has expired with its lesson (GUS-179): its lesson is before today
 * in America/Sao_Paulo (`today` is `todayInAppTimeZone`), or it was cancelled. Nobody decided it in
 * time, so it is out of the queue and can no longer be approved or declined.
 *
 * The cancellation of a lesson writes its pending applications `expired` in its own transaction;
 * the day turning writes nothing, so a pending application of a past lesson is only READ as expired,
 * through this rule, by the lists and by the decisions about it. A cancelled lesson is here for the
 * applications of a lesson cancelled before GUS-179. A pending direct assignment never expires: it
 * is the decision of the board, and it can be confirmed after the lesson (A12).
 */
export function isExpiredApplication(
  assignment: ExpiryAssignment,
  lesson: ExpiryLesson,
  today: string,
): boolean {
  return (
    assignment.status === AssignmentStatus.PENDING &&
    assignment.source === AssignmentSource.APPLICATION &&
    (lesson.status === LessonStatus.CANCELLED || lesson.date < today)
  );
}

/**
 * The status an assignment is answered with: `expired` for a pending application that expired with
 * its lesson (`isExpiredApplication`), the stored one otherwise. Every list of assignments goes
 * through it, so "pending" never shows for an application nobody can decide anymore.
 */
export function statusAsOf(
  assignment: ExpiryAssignment,
  lesson: ExpiryLesson,
  today: string,
): AssignmentStatus {
  return isExpiredApplication(assignment, lesson, today)
    ? AssignmentStatus.EXPIRED
    : assignment.status;
}
