import { ValueTransformer } from "typeorm";

/**
 * Reads a Postgres `time` column as "HH:mm". The driver hands it over as text with the seconds
 * ("14:00:00", or "14:00:00.5" when there are fractions), while the API and the entities talk
 * "HH:mm". Cutting it in the transformer means the entity always carries the same shape the DTOs
 * accept, so comparing a stored time with a sent one ("14:00" against "14:00:00") never sees a
 * change where there is none.
 *
 * Use with `@Column({ type: "time", transformer: timeOfDayTransformer })`. Writing takes the value
 * as it comes ("HH:mm" is a valid `time` literal), so `to` passes it on; `null` and `undefined`
 * pass through both ways.
 */
export const timeOfDayTransformer: ValueTransformer = {
  to: (value: string | null | undefined): string | null | undefined => value,
  from: (value: string | null | undefined): string | null | undefined =>
    typeof value === "string" ? value.slice(0, 5) : value,
};
