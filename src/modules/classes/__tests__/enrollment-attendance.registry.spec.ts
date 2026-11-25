import { EntityManager } from "typeorm";
import {
  EnrollmentAttendanceReader,
  EnrollmentAttendanceRegistry,
} from "../services/enrollment-attendance.registry";

describe("EnrollmentAttendanceRegistry", () => {
  const ENROLLMENT_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
  const manager = {} as EntityManager;

  function readerOf(rates: Map<string, number>, count: number): EnrollmentAttendanceReader {
    return {
      attendanceRates: jest.fn().mockResolvedValue(rates),
      countAttendance: jest.fn().mockResolvedValue(count),
    };
  }

  it("answers an empty map and a count of 0 without a reader", async () => {
    const registry = new EnrollmentAttendanceRegistry();

    await expect(registry.attendanceRates([ENROLLMENT_ID])).resolves.toEqual(new Map());
    await expect(registry.countAttendance(manager, ENROLLMENT_ID)).resolves.toBe(0);
  });

  it("delegates attendanceRates and countAttendance to the registered reader", async () => {
    const registry = new EnrollmentAttendanceRegistry();
    const rates = new Map([[ENROLLMENT_ID, 0.5]]);
    const reader = readerOf(rates, 3);
    registry.register(reader);

    await expect(registry.attendanceRates([ENROLLMENT_ID])).resolves.toBe(rates);
    await expect(registry.countAttendance(manager, ENROLLMENT_ID)).resolves.toBe(3);
    expect(reader.attendanceRates).toHaveBeenCalledWith([ENROLLMENT_ID]);
    expect(reader.countAttendance).toHaveBeenCalledWith(manager, ENROLLMENT_ID);
  });

  it("throws when a second reader registers", () => {
    const registry = new EnrollmentAttendanceRegistry();
    registry.register(readerOf(new Map(), 0));

    expect(() => registry.register(readerOf(new Map(), 0))).toThrow("already registered");
  });
});
