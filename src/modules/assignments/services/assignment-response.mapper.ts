import { ConfirmedStaffCount, toLessonCoverage } from "@modules/lessons/services/lesson-coverage";
import { LessonAgendaRef } from "@modules/lessons/services/lesson-listing.service";
import { LessonSummary } from "@modules/lessons/services/lessons.service";
import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";
import { AssignmentLessonResponseDto } from "../dto/assignment-lesson.response.dto";
import { LessonAssignmentResponseDto } from "../dto/lesson-assignment.response.dto";
import { MemberAssignmentResponseDto } from "../dto/member-assignment.response.dto";
import { MyAssignmentResponseDto } from "../dto/my-assignments.response.dto";
import { OpenLessonResponseDto } from "../dto/open-lesson.response.dto";
import { LessonAssignment } from "../entities/lesson-assignment.entity";
import { AssignmentStatus } from "../enums/assignment-status.enum";
import { statusAsOf } from "./assignment-status";
import { openRolesOf } from "./role-vacancy";

/**
 * What the one who asks may read of an assignment. It is a parameter with no default, so every
 * caller of the mapper has to decide it: the one that forgets does not compile, and a default that
 * showed everything would leak the note the day a route is opened to another profile.
 */
export interface AssignmentVisibility {
  /**
   * Whether the `note` is shown. The note is free text and can hold personal data (RNF-13), so only
   * who can manage assignments (`assignments.create`) reads it, and in the queue of the applications
   * who reviews them (`assignments.review`, GUS-160); everybody else gets `note: null`, whether the
   * assignment has a note or not.
   */
  canSeeNote: boolean;
}

/**
 * The answer of the routes that create, confirm and cancel an assignment, and the item of the list
 * of a lesson: the assignment with the member it is for. `person` is null when the person is gone,
 * and `note` is null for whoever `visibility` keeps it from. The optional columns are missing
 * (undefined) on an entity that was just inserted, not loaded, so they are read as null.
 *
 * `status` is the stored one unless the caller says otherwise: the list of a lesson passes
 * `statusAsOf` (an application of a past lesson reads `expired`, GUS-179). A write answers what it
 * has just written, and the queue only lists applications that are still pending.
 */
export function toLessonAssignmentResponse(
  assignment: LessonAssignment,
  person: PersonRefDto | null,
  visibility: AssignmentVisibility,
  status: AssignmentStatus = assignment.status,
): LessonAssignmentResponseDto {
  return {
    id: assignment.id,
    lessonId: assignment.lessonId,
    person: person === null ? null : { id: person.id, name: person.name },
    role: assignment.role,
    status,
    statusReason: assignment.statusReason ?? null,
    source: assignment.source,
    note: visibility.canSeeNote ? (assignment.note ?? null) : null,
    createdById: assignment.createdById,
    reviewedById: assignment.reviewedById ?? null,
    reviewedAt: assignment.reviewedAt ?? null,
    cancelledById: assignment.cancelledById ?? null,
    cancelledAt: assignment.cancelledAt ?? null,
    createdAt: assignment.createdAt,
    updatedAt: assignment.updatedAt,
  };
}

/**
 * The item of the list of a member: the lesson she is assigned to (what says which one it is and
 * when) and what she does in it, with the status as of `today` (`statusAsOf`, GUS-179) and why the
 * system ended it. Nothing of her class or course, and no note.
 */
export function toMemberAssignmentResponse(
  assignment: LessonAssignment,
  lesson: LessonSummary,
  today: string,
): MemberAssignmentResponseDto {
  return {
    id: assignment.id,
    lesson: {
      id: lesson.id,
      title: lesson.title,
      date: lesson.date,
      startTime: lesson.startTime,
      endTime: lesson.endTime,
      status: lesson.status,
    },
    role: assignment.role,
    status: statusAsOf(assignment, lesson, today),
    statusReason: assignment.statusReason ?? null,
    source: assignment.source,
    createdAt: assignment.createdAt,
  };
}

/**
 * The lesson as the agenda of the member and the pending applications show it (GUS-160): what says
 * which one it is, when and where, its position in the sequence and its class.
 */
export function toAssignmentLesson(ref: LessonAgendaRef): AssignmentLessonResponseDto {
  return {
    id: ref.id,
    title: ref.title,
    date: ref.date,
    startTime: ref.startTime,
    endTime: ref.endTime,
    status: ref.status,
    sequenceOrder: ref.sequenceOrder,
    location: ref.location,
    class: { id: ref.class.id, code: ref.class.code, name: ref.class.name },
  };
}

/**
 * An item of "Minhas aulas" (GUS-160): the lesson with its class and what the member does in it,
 * and where it stands as of `today` (`statusAsOf`, GUS-179). No note: the agenda of the member does
 * not carry it.
 */
export function toMyAssignmentResponse(
  assignment: LessonAssignment,
  ref: LessonAgendaRef,
  today: string,
): MyAssignmentResponseDto {
  return {
    id: assignment.id,
    lesson: toAssignmentLesson(ref),
    role: assignment.role,
    status: statusAsOf(assignment, ref, today),
    statusReason: assignment.statusReason ?? null,
    source: assignment.source,
  };
}

/**
 * A lesson with an open place for the member (GUS-160): the lesson with its class, its coverage (the
 * same as the lesson itself shows) and the roles it has an open place for, by the rule of
 * `role-vacancy.ts`, the teacher first.
 */
export function toOpenLessonResponse(
  ref: LessonAgendaRef,
  staff: ConfirmedStaffCount,
): OpenLessonResponseDto {
  return {
    lesson: toAssignmentLesson(ref),
    coverage: toLessonCoverage(ref, staff).coverage,
    openRoles: openRolesOf(ref, staff),
  };
}
