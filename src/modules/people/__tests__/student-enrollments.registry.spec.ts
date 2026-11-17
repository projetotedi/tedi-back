import { EntityManager } from "typeorm";
import { StudentEnrollmentsRegistry } from "../services/student-enrollments.registry";

const STUDENT_ID = "01999a3e-7c1b-7000-8000-000000000001";

describe("StudentEnrollmentsRegistry", () => {
  const manager = {} as EntityManager;

  it("answers 0 when no reader is registered", async () => {
    const registry = new StudentEnrollmentsRegistry();

    await expect(registry.countActiveEnrollments(manager, STUDENT_ID)).resolves.toBe(0);
  });

  it("delegates to the registered reader with the manager and the student id", async () => {
    const registry = new StudentEnrollmentsRegistry();
    const reader = { countActiveEnrollments: jest.fn().mockResolvedValue(2) };
    registry.register(reader);

    await expect(registry.countActiveEnrollments(manager, STUDENT_ID)).resolves.toBe(2);
    expect(reader.countActiveEnrollments).toHaveBeenCalledWith(manager, STUDENT_ID);
  });

  it("throws when a second reader registers", () => {
    const registry = new StudentEnrollmentsRegistry();
    registry.register({ countActiveEnrollments: jest.fn() });

    expect(() => registry.register({ countActiveEnrollments: jest.fn() })).toThrow(
      "A student enrollments reader is already registered.",
    );
  });
});
