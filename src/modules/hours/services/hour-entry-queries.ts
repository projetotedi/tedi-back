import { SelectQueryBuilder } from "typeorm";
import { HourEntry } from "../entities/hour-entry.entity";

/**
 * Whose entries a reading of the team covers: everyone, or the people of a list. The list comes
 * from the people module (a department, a search), and an empty list is nobody.
 */
export type HoursPopulation =
  | { kind: "everyone" }
  | { kind: "people"; personIds: readonly string[] };

export const EVERYONE: HoursPopulation = { kind: "everyone" };

export function populationOf(personIds: readonly string[]): HoursPopulation {
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

/** The order of the queue of validation: the oldest day first, then the oldest entry. */
export function applyQueueOrder(builder: SelectQueryBuilder<HourEntry>): void {
  builder
    .orderBy("entry.date", "ASC")
    .addOrderBy("entry.created_at", "ASC")
    .addOrderBy("entry.id", "ASC");
}
