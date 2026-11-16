import { DataSource } from "typeorm";
import { Lesson } from "../../entities/lesson.entity";
import { LessonStatus } from "../../enums/lesson-status.enum";

/**
 * Fixtures of the lessons module for its e2e. The scenery of a test (the person, the course, the
 * class, the lesson plan and the sequence of the course) is made through the services that the
 * other modules export, not through their tables: this file only holds what is about a lesson.
 */

/**
 * The period of the class of the scenery, INFO-A in 2026.1 (the same one of the card of the
 * classes). The first and the last day are the ends a lesson can still take.
 */
export const CLASS_PERIOD = { startDate: "2026-03-03", endDate: "2026-06-27" } as const;

/**
 * The body of the lesson of the card, without the class: "Teclado, mouse e janelas" on 2026-03-10,
 * from 14:00 to 15:30 (90 minutes), inside the period of the class. The test adds `classId` (and
 * whatever else it exercises) through `overrides`, which win over every default.
 */
export function lessonBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Teclado, mouse e janelas",
    date: "2026-03-10",
    startTime: "14:00",
    endTime: "15:30",
    ...overrides,
  };
}

/**
 * Inserts a lesson straight through the repository of the module, with no service in between: the
 * test of a list needs dozens of lessons in known days, statuses and classes, and does not go
 * through the rules of `POST /lessons` (period of the class, plan, locks) to get them. `create` and
 * then `save`, so the `@BeforeInsert` of the entity gives the id.
 *
 * The lesson is "Teclado, mouse e janelas" on 2026-03-10, from 14:00 to 15:30, `planned`, unless
 * `values` says otherwise (they win over every default). A `cancelled` lesson needs the instant of
 * the cancellation, which `ck_lessons_cancellation` demands, and gets it, with its author and a
 * reason, unless `values` gives them.
 */
export async function insertLesson(
  dataSource: DataSource,
  values: { classId: string; createdById: string } & Partial<Lesson>,
): Promise<Lesson> {
  const repository = dataSource.getRepository(Lesson);
  const cancellation =
    values.status === LessonStatus.CANCELLED
      ? {
          cancelReason: "Feriado municipal.",
          cancelledAt: new Date("2026-03-09T12:00:00.000Z"),
          cancelledById: values.createdById,
        }
      : {};

  return repository.save(
    repository.create({
      title: "Teclado, mouse e janelas",
      date: "2026-03-10",
      startTime: "14:00",
      endTime: "15:30",
      ...cancellation,
      ...values,
    }),
  );
}
