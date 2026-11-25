import { Injectable } from "@nestjs/common";
import { isUUID } from "class-validator";
import { DataSource, EntityManager } from "typeorm";
import { LessonAssignment } from "../entities/lesson-assignment.entity";
import { AssignmentRole } from "../enums/assignment-role.enum";
import { AssignmentStatus } from "../enums/assignment-status.enum";

/** A confirmed assignment of a lesson, as another module needs it: which one, whose and as what. */
export interface ConfirmedAssignment {
  id: string;
  personId: string;
  role: AssignmentRole;
}

/**
 * The confirmed staff of a lesson for another module: the attendance of the members (GUS-168),
 * whose targets are these assignments and whose `lessonTeacherIds` is the confirmed teacher among
 * them. It reads no person and writes nothing.
 */
@Injectable()
export class ConfirmedStaffService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * The CONFIRMED assignments of a lesson, ordered by role in the order of the enum (the teacher
   * first), then by when they were made, then by id. A pending, declined, cancelled or soft-deleted
   * one is not staff. An id that is not a UUID answers [] without querying (Postgres would answer
   * 22P02).
   *
   * Pass the `manager` of a transaction to read inside it. `forShare` locks the rows FOR SHARE until
   * the end of that transaction (it needs the `manager` of one: Postgres only keeps a row lock inside
   * a transaction), which conflicts with the FOR UPDATE that `AssignmentsService.confirm` and
   * `cancel` take: an attendance is never signed through an assignment that is being cancelled.
   */
  async findConfirmedAssignments(
    lessonId: string,
    manager?: EntityManager,
    options: { forShare?: boolean } = {},
  ): Promise<ConfirmedAssignment[]> {
    if (options.forShare === true && manager === undefined) {
      throw new Error(
        "Locking the confirmed assignments of a lesson needs the manager of a transaction.",
      );
    }
    if (!isUUID(lessonId)) return [];

    const rows = await (manager ?? this.dataSource.manager).find(LessonAssignment, {
      select: { id: true, personId: true, role: true },
      where: { lessonId, status: AssignmentStatus.CONFIRMED },
      order: { role: "ASC", createdAt: "ASC", id: "ASC" },
      ...(options.forShare === true ? { lock: { mode: "pessimistic_read" as const } } : {}),
    });

    return rows.map((row) => ({ id: row.id, personId: row.personId, role: row.role }));
  }
}

// The enum of the contract of `findConfirmedAssignments`, re-exported so that the attendance imports
// it from the service AssignmentsModule exports and never from `assignments/enums/*`.
export { AssignmentRole } from "../enums/assignment-role.enum";
