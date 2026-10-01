/**
 * Reusable class-transformer transforms for input DTOs.
 * They only touch strings: any other value passes through so the validators can reject it.
 */

/** Trims strings; "" becomes null. */
export const trimToNull = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() || null : value;

/** Same as trimToNull, plus lower case (e-mail). */
export const trimLowerToNull = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim().toLowerCase() || null : value;

/** Trims strings; "" stays "" so @IsNotEmpty can report it. */
export const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;
