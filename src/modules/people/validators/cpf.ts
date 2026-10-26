import { registerDecorator, ValidationOptions } from "class-validator";

/**
 * Strips dots, dash and spaces; "" becomes null.
 * Letters are kept on purpose so IsCpf rejects them instead of hiding the typo.
 */
export const normalizeCpf = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.replace(/[\s.-]/g, "") || null : value;

const CPF_DIGITS = /^\d{11}$/;

/**
 * Check digit at position `length` (9 or 10): weighted sum of the digits before it, weights
 * from `length + 1` down to 2, then (sum * 10) mod 11 with a remainder of 10 counting as 0.
 */
function checkDigit(digits: readonly number[], length: number): number {
  let sum = 0;
  for (let index = 0; index < length; index++) {
    sum += digits[index] * (length + 1 - index);
  }
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

/** 11 digits, not all equal, both check digits right (mod 11). Expects the value already normalized. */
export function isValidCpf(value: string): boolean {
  if (!CPF_DIGITS.test(value)) return false;

  const digits = [...value].map(Number);
  if (digits.every((digit) => digit === digits[0])) return false;

  return checkDigit(digits, 9) === digits[9] && checkDigit(digits, 10) === digits[10];
}

/** What a CPF that cannot be masked by position shows: nothing of it. */
const FULLY_MASKED_CPF = "***.***.***-**";

/**
 * CPF for display (RNF-14): the digits are stored without formatting and only the last five
 * show, `52998224725` becomes `***.***.247-25`. The one place that masks a CPF; routes that
 * show it to someone who is not coordination (GUS-122 "Meu perfil", GUS-144) call it here.
 *
 * `null` stays `null` (no CPF registered). Anything that is not exactly 11 digits comes out
 * fully masked (`***.***.***-**`): a malformed value must never leak through the mask.
 */
export function maskCpf(cpf: string | null): string | null {
  if (cpf === null) return null;
  if (!CPF_DIGITS.test(cpf)) return FULLY_MASKED_CPF;
  return `***.***.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

/**
 * class-validator decorator for a CPF (RF-004). Message: "cpf must be a valid CPF".
 * The message never echoes the value: a CPF is personal data (RNF-14) and must not reach logs.
 */
export function IsCpf(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: "isCpf",
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: `${String(propertyName)} must be a valid CPF`, ...options },
      validator: {
        validate: (value: unknown) => typeof value === "string" && isValidCpf(value),
      },
    });
  };
}
