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
 * The titles of the four lesson plans of the sequence of the course in the e2e of the generation
 * (GUS-154), in the order of the sequence: the ones of the modal of the Figma. The plans are made
 * through the service of the catalog, 90 minutes each.
 */
export const GENERATION_PLAN_TITLES = [
  "Conhecendo o computador",
  "Teclado, mouse e janelas",
  "Navegando na internet",
  "Senhas e privacidade",
] as const;

/**
 * A class that ends before the series of the card does: from 2026-03-03 to 2026-04-24, so of the
 * four lessons of a tuesday series from 2026-04-07 (07, 14, 21 and 28 of April) the last one falls
 * outside it. The warning of the Figma: "A turma termina em 24/04/2026".
 */
export const SHORT_CLASS_PERIOD = { startDate: "2026-03-03", endDate: "2026-04-24" } as const;

/**
 * The body of the generation of the card: toda terça, das 09:00 às 11:00 (120 minutes), a partir
 * de 2026-04-07, no Laboratório 2 — Bloco B. The test adds whatever it exercises through
 * `overrides`, which win over every default.
 */
export function generationBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    weekday: "tuesday",
    startTime: "09:00",
    endTime: "11:00",
    firstDate: "2026-04-07",
    location: "Laboratório 2 — Bloco B",
    ...overrides,
  };
}
