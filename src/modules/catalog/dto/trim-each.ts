export const trimEach = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value)
    ? value.map((item: unknown) => (typeof item === "string" ? item.trim() : item))
    : value;
