import "reflect-metadata";
import { EntityManager } from "typeorm";
import { StudentEnrollmentsRegistry } from "@modules/people/services/student-enrollments.registry";
import { EnrollmentCountsService } from "../services/enrollment-counts.service";

const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const OTHER_CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c2";
const STUDENT_ID = "01999a3e-7c1b-7000-8000-000000000001";
const ENROLLMENT_ID = "01999a3e-7c1b-7000-8000-0000000000f1";

describe("EnrollmentCountsService", () => {
  const query = jest.fn();
  const manager = { query } as unknown as EntityManager;
  const registry = new StudentEnrollmentsRegistry();
  const service = new EnrollmentCountsService(registry);

  beforeEach(() => jest.resetAllMocks());

  it("registers itself in the StudentEnrollmentsRegistry when the module starts", async () => {
    const fresh = new StudentEnrollmentsRegistry();
    const counts = new EnrollmentCountsService(fresh);
    query.mockResolvedValue([{ total: 2 }]);

    await expect(fresh.countActiveEnrollments(manager, STUDENT_ID)).resolves.toBe(0);
    counts.onModuleInit();
    await expect(fresh.countActiveEnrollments(manager, STUDENT_ID)).resolves.toBe(2);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE student_id = $1"), [
      STUDENT_ID,
      "active",
    ]);
  });

  it("answers an empty map without querying for no class ids", async () => {
    await expect(service.countActiveByClass(manager, [])).resolves.toEqual(new Map());

    expect(query).not.toHaveBeenCalled();
  });

  it("counts with the manager it is given and never asks for a lock", async () => {
    query.mockResolvedValueOnce([{ total: 12 }]);
    await expect(service.countActive(manager, CLASS_ID)).resolves.toBe(12);

    query.mockResolvedValueOnce([
      { classId: CLASS_ID, total: 3 },
      { classId: OTHER_CLASS_ID, total: 1 },
    ]);
    await expect(service.countActiveByClass(manager, [CLASS_ID, OTHER_CLASS_ID])).resolves.toEqual(
      new Map([
        [CLASS_ID, 3],
        [OTHER_CLASS_ID, 1],
      ]),
    );

    const enrolledAt = new Date("2026-03-03T13:00:00.000Z");
    query.mockResolvedValueOnce([
      { enrollmentId: ENROLLMENT_ID, studentId: STUDENT_ID, enrolledAt },
    ]);
    await expect(service.listActivePreview(manager, CLASS_ID, 5)).resolves.toEqual([
      { enrollmentId: ENROLLMENT_ID, studentId: STUDENT_ID, enrolledAt },
    ]);

    query.mockResolvedValueOnce([{ total: 0 }]);
    await expect(service.countActiveEnrollments(manager, STUDENT_ID)).resolves.toBe(0);

    const calls = query.mock.calls.map(([sql, parameters]: [string, unknown[]]) => ({
      sql,
      parameters,
    }));
    expect(calls.map((call) => call.parameters)).toEqual([
      [CLASS_ID, "active"],
      [[CLASS_ID, OTHER_CLASS_ID], "active"],
      [CLASS_ID, "active", 5],
      [STUDENT_ID, "active"],
    ]);
    for (const { sql } of calls) {
      // Only live, active enrollments count; the lock is the caller's.
      expect(sql).toContain("status = $2");
      expect(sql).toContain("deleted_at IS NULL");
      expect(sql).not.toMatch(/FOR (UPDATE|SHARE|NO KEY|KEY)/);
    }
    expect(calls[1].sql).toContain("class_id = ANY($1::uuid[])");
    expect(calls[1].sql).toContain("GROUP BY class_id");
    // The preview keeps its order on every call: enrolledAt, then the id.
    expect(calls[2].sql).toContain("ORDER BY enrolled_at, id");
    expect(calls[2].sql).toContain("LIMIT $3");
  });

  it("counts the live enrollments of a class, in any status, for the change of course", async () => {
    query.mockResolvedValueOnce([{ total: 3 }]);

    await expect(service.countLive(manager, CLASS_ID)).resolves.toBe(3);

    const [sql, parameters] = query.mock.calls[0];
    expect(parameters).toEqual([CLASS_ID]);
    expect(sql).toContain("deleted_at IS NULL");
    // Every status counts: a completed enrollment is a course the student completed (RN-16).
    expect(sql).not.toContain("status");
    expect(sql).not.toMatch(/FOR (UPDATE|SHARE|NO KEY|KEY)/);
  });
});
