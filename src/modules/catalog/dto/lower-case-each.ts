/**
 * Lower-cases each string of a list; anything else passes through so the validators can reject it.
 * A UUID is case-insensitive in Postgres: without this, "ABC..." and "abc..." would pass
 * @ArrayUnique as two ids of the same course.
 */
export const lowerCaseEach = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value)
    ? value.map((item: unknown) => (typeof item === "string" ? item.toLowerCase() : item))
    : value;
