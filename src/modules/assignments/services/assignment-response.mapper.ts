import { LessonSummary } from "@modules/lessons/services/lessons.service";
import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";
import { LessonAssignmentResponseDto } from "../dto/lesson-assignment.response.dto";
import { MemberAssignmentResponseDto } from "../dto/member-assignment.response.dto";
import { LessonAssignment } from "../entities/lesson-assignment.entity";

/**
 * What the one who asks may read of an assignment. It is a parameter with no default, so every
 * caller of the mapper has to decide it: the one that forgets does not compile, and a default that
 * showed everything would leak the note the day a route is opened to another profile.
 */
export interface AssignmentVisibility {
  /**
   * Whether the `note` is shown. The note is free text and can hold personal data (RNF-13), so only
   * who can manage assignments (`assignments.create`) reads it; everybody else gets `note: null`,
   * whether the assignment has a note or not.
   */
  canSeeNote: boolean;
}

/**
 * The answer of the routes that create, confirm and cancel an assignment, and the item of the list
 * of a lesson: the assignment with the member it is for. `person` is null when the person is gone,
 * and `note` is null for whoever `visibility` keeps it from. The optional columns are missing
 * (undefined) on an entity that was just inserted, not loaded, so they are read as null.
 */
export function toLessonAssignmentResponse(
  assignment: LessonAssignment,
  person: PersonRefDto | null,
  visibility: AssignmentVisibility,
): LessonAssignmentResponseDto {
  return {
    id: assignment.id,
    lessonId: assignment.lessonId,
    person: person === null ? null : { id: person.id, name: person.name },
    role: assignment.role,
    status: assignment.status,
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
 * when) and what she does in it. Nothing of her class or course, and no note.
 */
export function toMemberAssignmentResponse(
  assignment: LessonAssignment,
  lesson: LessonSummary,
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
    status: assignment.status,
    source: assignment.source,
    createdAt: assignment.createdAt,
  };
}
