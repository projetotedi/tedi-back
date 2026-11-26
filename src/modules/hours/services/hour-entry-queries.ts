import { SelectQueryBuilder } from "typeorm";
import { HourEntry } from "../entities/hour-entry.entity";
import { HoursSummaryRow } from "./hours-summary";

/**
 * Whose entries a reading of the team covers: everyone, or the people of a list. The list comes
 * from the people module (a department, a search), and an empty list is nobody.
 */
export type HoursPopulation =
  | { kind: "everyone" }
  | { kind: "people"; personIds: readonly string[] };

export const EVERYONE: HoursPopulation = { kind: "everyone" };

export function peoplePopulation(personIds: readonly string[]): HoursPopulation {
  return { kind: "people", personIds };
}

/** True for an empty list of people: the caller answers empty without querying. */
export function isNobody(population: HoursPopulation): boolean {
  return population.kind === "people" && population.personIds.length === 0;
}

/**
 * Restricts the query (alias `entry`) to the population. Throws for nobody: `IN ()` is not SQL,
 * and the caller answers empty before it gets here.
 */
export function applyPopulation(
  builder: SelectQueryBuilder<HourEntry>,
  population: HoursPopulation,
): void {
  if (population.kind === "everyone") return;
  if (population.personIds.length === 0) {
    throw new Error("An hours query cannot be restricted to nobody: answer empty before querying.");
  }
  builder.andWhere("entry.person_id IN (:...personIds)", {
    personIds: [...population.personIds],
  });
}

/**
 * The totals of the query (alias `entry`) grouped by status and category, at most 28 rows. The
 * same select as the summary of the person (HoursService.getMySummary), kept apart while GUS-162 is
 * under review. The sums are cast to `int`: Postgres sums into `bigint`, which `pg` hands over as a
 * string.
 */
export function selectSummaryRows(
  builder: SelectQueryBuilder<HourEntry>,
): Promise<HoursSummaryRow[]> {
  return builder
    .select("entry.status", "status")
    .addSelect("entry.category", "category")
    .addSelect("COUNT(*)::int", "entries")
    .addSelect("COALESCE(SUM(entry.declared_minutes), 0)::int", "declaredMinutes")
    .addSelect("COALESCE(SUM(entry.validated_minutes), 0)::int", "validatedMinutes")
    .groupBy("entry.status")
    .addGroupBy("entry.category")
    .getRawMany<HoursSummaryRow>();
}

/** The order of a statement: the most recent day first, then the most recent entry. */
export function applyStatementOrder(builder: SelectQueryBuilder<HourEntry>): void {
  builder
    .orderBy("entry.date", "DESC")
    .addOrderBy("entry.created_at", "DESC")
    .addOrderBy("entry.id", "DESC");
}

/** The order of the queue of validation: the oldest day first, then the oldest entry. */
export function applyQueueOrder(builder: SelectQueryBuilder<HourEntry>): void {
  builder
    .orderBy("entry.date", "ASC")
    .addOrderBy("entry.created_at", "ASC")
    .addOrderBy("entry.id", "ASC");
}
