/** The 27 federative units (UF). A fixed fact, not a product list. */
export const BRAZILIAN_STATES = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const;

export type BrazilianState = (typeof BRAZILIAN_STATES)[number];

/** Trims and upper-cases; "" becomes null. Other types pass through so the validator rejects them. */
export const normalizeState = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim().toUpperCase() || null : value;
