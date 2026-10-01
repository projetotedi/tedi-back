/**
 * Strips formatting ( ) - . + and spaces; "" becomes null.
 * Letters are kept on purpose so PHONE_DIGITS rejects them instead of hiding the typo.
 */
export const normalizePhone = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== "string") return value;
  return value.replace(/[\s().+-]/g, "") || null;
};

/** DDD + number (10 to 11 digits), optionally with the country code (12 to 13). */
export const PHONE_DIGITS = /^\d{10,13}$/;
