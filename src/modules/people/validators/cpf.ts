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
