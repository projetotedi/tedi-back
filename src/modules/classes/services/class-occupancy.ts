/**
 * How full a class is: enrolled / capacity with two decimals (RF-035). There is no cap, so a class
 * over capacity reads above 1 (16 of 15 is 1.07).
 *
 * The count is multiplied by 100 before the division and the result is rounded once. Dividing
 * first and multiplying later (`a / b * 100`) carries the error of the float into the rounding.
 */
export function occupancyRateOf(enrolledCount: number, capacity: number): number {
  // Unreachable: ck_classes_capacity_positive and the @Min(1) of the DTOs. It only keeps a
  // division by zero (Infinity or NaN) from ever reaching the JSON.
  if (capacity <= 0) return 0;

  return Math.round((enrolledCount * 100) / capacity) / 100;
}
