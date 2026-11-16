import { DataSource } from "typeorm";

/**
 * Fixtures of the assignments module for its e2e. The scenery of a test (the person, the course, the
 * class and the lesson) is made through the services that the other modules export, not through
 * their tables: this file only holds what is about an assignment, and what the other modules export
 * for a test to reuse (the owner module exports the function, docs/ARCHITECTURE.md section 5).
 */

// The period of the class of the scenery and the body of a lesson inside it, from the lessons.
export { CLASS_PERIOD, lessonBody } from "@modules/lessons/__tests__/fixtures/lessons.fixture";

// A department, and the member profile that gives a director (or a member) one, from the people.
export {
  insertDepartment,
  insertMemberProfile,
} from "@modules/people/__tests__/fixtures/member-registration.fixture";

/**
 * The body of `POST /lessons/:id/assignments` of the card: a monitor, left pending. The test adds
 * `personId` (and whatever else it exercises) through `overrides`, which win over every default.
 */
export function assignmentBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    role: "monitor",
    status: "pending",
    ...overrides,
  };
}

/** A row of `lesson_assignments`, for a case that only another card creates (a declined application). */
export interface AssignmentRow {
  lessonId: string;
  personId: string;
  createdById: string;
  role?: "teacher" | "monitor";
  status?: "pending" | "confirmed" | "declined" | "cancelled";
  source?: "direct" | "application";
  note?: string | null;
  reviewedById?: string | null;
  reviewedAt?: Date | null;
  cancelledById?: string | null;
  cancelledAt?: Date | null;
}

/**
 * INSERT INTO lesson_assignments ... RETURNING id. It exists for the `declined` status, which only
 * the review of the applications (GUS-160) creates, so a test cannot reach it through the routes of
 * this card. The checks of the table still apply: a declined row carries `reviewedById` and
 * `reviewedAt` together, or neither.
 */
export async function insertAssignment(
  dataSource: DataSource,
  row: AssignmentRow,
): Promise<string> {
  const rows: Array<{ id: string }> = await dataSource.query(
    `INSERT INTO lesson_assignments
       (id, lesson_id, person_id, role, status, source, note, created_by_id,
        reviewed_by_id, reviewed_at, cancelled_by_id, cancelled_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      row.lessonId,
      row.personId,
      row.role ?? "monitor",
      row.status ?? "pending",
      row.source ?? "direct",
      row.note ?? null,
      row.createdById,
      row.reviewedById ?? null,
      row.reviewedAt ?? null,
      row.cancelledById ?? null,
      row.cancelledAt ?? null,
    ],
  );
  return rows[0].id;
}
