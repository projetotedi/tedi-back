import "reflect-metadata";
import { EntityManager } from "typeorm";
import { LessonStatus } from "../enums/lesson-status.enum";
import {
  ConfirmedStaff,
  ConfirmedStaffCount,
  EXPECTED_TEACHERS,
  isBelowExpectedMonitors,
  LessonStaffCounter,
  NO_CONFIRMED_STAFF,
  toLessonCoverage,
} from "../services/lesson-coverage";
import { LessonCoverageRegistry } from "../services/lesson-coverage.registry";

const LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
const OTHER_LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f2";

function staff(teachers: number, monitors: number): ConfirmedStaffCount {
  return { teachers, monitors };
}

describe("toLessonCoverage", () => {
  it("shows the confirmed teacher against the one a lesson has, and the monitors against the expectation", () => {
    const { coverage } = toLessonCoverage(
      { status: LessonStatus.PLANNED, expectedMonitors: 3 },
      staff(1, 2),
    );

    expect(coverage).toEqual({
      teacher: { confirmed: 1, expected: 1 },
      monitors: { confirmed: 2, expected: 3 },
    });
  });

  it("always expects one teacher, whatever the lesson says", () => {
    expect(EXPECTED_TEACHERS).toBe(1);
    for (const expectedMonitors of [null, 0, 5]) {
      const { coverage } = toLessonCoverage(
        { status: LessonStatus.PLANNED, expectedMonitors },
        NO_CONFIRMED_STAFF,
      );

      expect(coverage.teacher).toEqual({ confirmed: 0, expected: 1 });
    }
  });

  describe("with expectedMonitors null (not informed)", () => {
    it("shows a null expectation and is never below it, with or without monitors", () => {
      for (const monitors of [0, 1, 4]) {
        const result = toLessonCoverage(
          { status: LessonStatus.PLANNED, expectedMonitors: null },
          staff(1, monitors),
        );

        expect(result.coverage.monitors).toEqual({ confirmed: monitors, expected: null });
        expect(result.belowExpectedMonitors).toBe(false);
      }
    });
  });

  describe("with fewer confirmed monitors than expected", () => {
    it("is below the expectation", () => {
      for (const [monitors, expected] of [
        [0, 1],
        [1, 2],
        [2, 5],
      ]) {
        const result = toLessonCoverage(
          { status: LessonStatus.PLANNED, expectedMonitors: expected },
          staff(1, monitors),
        );

        expect(result.belowExpectedMonitors).toBe(true);
      }
    });

    it("is below it for every status of a lesson that still happens", () => {
      for (const status of [LessonStatus.PLANNED, LessonStatus.CONFIRMED, LessonStatus.DONE]) {
        const result = toLessonCoverage({ status, expectedMonitors: 2 }, staff(1, 1));

        expect(result.belowExpectedMonitors).toBe(true);
      }
    });

    it("does not count the teacher as a monitor: a lesson with a teacher and no monitor is below", () => {
      const result = toLessonCoverage(
        { status: LessonStatus.PLANNED, expectedMonitors: 1 },
        staff(1, 0),
      );

      expect(result.belowExpectedMonitors).toBe(true);
    });
  });

  describe("with as many confirmed monitors as expected, or more", () => {
    it("is not below the expectation", () => {
      for (const [monitors, expected] of [
        [2, 2],
        [3, 2],
        [1, 1],
      ]) {
        const result = toLessonCoverage(
          { status: LessonStatus.PLANNED, expectedMonitors: expected },
          staff(1, monitors),
        );

        expect(result.belowExpectedMonitors).toBe(false);
      }
    });

    it("expecting zero monitors is met by nobody: not below", () => {
      const result = toLessonCoverage(
        { status: LessonStatus.PLANNED, expectedMonitors: 0 },
        NO_CONFIRMED_STAFF,
      );

      expect(result.coverage.monitors).toEqual({ confirmed: 0, expected: 0 });
      expect(result.belowExpectedMonitors).toBe(false);
    });
  });

  describe("for a cancelled lesson", () => {
    it("shows the coverage but is never below the expectation: nobody is missing from a lesson that does not happen", () => {
      const result = toLessonCoverage(
        { status: LessonStatus.CANCELLED, expectedMonitors: 3 },
        staff(0, 1),
      );

      expect(result.coverage).toEqual({
        teacher: { confirmed: 0, expected: 1 },
        monitors: { confirmed: 1, expected: 3 },
      });
      expect(result.belowExpectedMonitors).toBe(false);
    });
  });

  it("reads the expectation of an entity that was just inserted, with no expectedMonitors, as null", () => {
    const result = toLessonCoverage(
      { status: LessonStatus.PLANNED, expectedMonitors: undefined as unknown as null },
      NO_CONFIRMED_STAFF,
    );

    expect(result.coverage.monitors.expected).toBeNull();
    expect(result.belowExpectedMonitors).toBe(false);
  });
});

describe("isBelowExpectedMonitors", () => {
  it("is true when fewer monitors are confirmed than the lesson expects", () => {
    for (const [monitors, expectedMonitors] of [
      [0, 1],
      [1, 2],
      [2, 5],
    ]) {
      expect(
        isBelowExpectedMonitors({ status: LessonStatus.PLANNED, expectedMonitors }, { monitors }),
      ).toBe(true);
    }
  });

  it("is false when as many monitors are confirmed as expected, or more", () => {
    for (const [monitors, expectedMonitors] of [
      [2, 2],
      [3, 2],
      [1, 1],
    ]) {
      expect(
        isBelowExpectedMonitors({ status: LessonStatus.PLANNED, expectedMonitors }, { monitors }),
      ).toBe(false);
    }
  });

  it("is false when the lesson expects zero monitors, or does not say how many it expects", () => {
    for (const expectedMonitors of [0, null]) {
      expect(
        isBelowExpectedMonitors(
          { status: LessonStatus.PLANNED, expectedMonitors },
          { monitors: 0 },
        ),
      ).toBe(false);
    }
  });

  it("is false for a cancelled lesson, whoever is confirmed in it", () => {
    for (const monitors of [0, 1, 5]) {
      expect(
        isBelowExpectedMonitors(
          { status: LessonStatus.CANCELLED, expectedMonitors: 3 },
          { monitors },
        ),
      ).toBe(false);
    }
  });

  it("is true for every status of a lesson that still happens", () => {
    for (const status of [LessonStatus.PLANNED, LessonStatus.CONFIRMED, LessonStatus.DONE]) {
      expect(isBelowExpectedMonitors({ status, expectedMonitors: 2 }, { monitors: 1 })).toBe(true);
    }
  });

  it("reads the expectation of an entity that was just inserted, with no expectedMonitors, as null", () => {
    expect(
      isBelowExpectedMonitors(
        { status: LessonStatus.PLANNED, expectedMonitors: undefined as unknown as null },
        { monitors: 0 },
      ),
    ).toBe(false);
  });

  it("is the rule that toLessonCoverage answers, so the detail, the list and the calendar agree", () => {
    for (const status of Object.values(LessonStatus)) {
      for (const expectedMonitors of [null, 0, 2]) {
        for (const monitors of [0, 1, 2, 3]) {
          const lesson = { status, expectedMonitors };

          expect(toLessonCoverage(lesson, staff(1, monitors)).belowExpectedMonitors).toBe(
            isBelowExpectedMonitors(lesson, { monitors }),
          );
        }
      }
    }
  });
});

describe("NO_CONFIRMED_STAFF", () => {
  it("is zero teachers, zero monitors and no teacher, and cannot be changed by whoever reads it", () => {
    expect(NO_CONFIRMED_STAFF).toEqual({ teachers: 0, monitors: 0, teacher: null });
    expect(Object.isFrozen(NO_CONFIRMED_STAFF)).toBe(true);
  });

  it("serves the reads that only count as well as the ones that name the teacher", () => {
    const counts: ConfirmedStaffCount = NO_CONFIRMED_STAFF;
    const named: ConfirmedStaff = NO_CONFIRMED_STAFF;

    expect(counts.teachers + counts.monitors).toBe(0);
    expect(named.teacher).toBeNull();
  });
});

describe("LessonCoverageRegistry", () => {
  function counterAnswering(
    answer: Map<string, ConfirmedStaffCount>,
    found: Map<string, ConfirmedStaff> = new Map(),
  ) {
    return {
      countConfirmedStaff: jest.fn().mockResolvedValue(answer),
      findConfirmedStaff: jest.fn().mockResolvedValue(found),
    };
  }

  it("answers an empty map when no counter is registered: nobody is assigned as far as lessons know", async () => {
    const registry = new LessonCoverageRegistry();

    const result = await registry.countConfirmedStaff([LESSON_ID, OTHER_LESSON_ID]);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
    expect(result.get(LESSON_ID) ?? NO_CONFIRMED_STAFF).toBe(NO_CONFIRMED_STAFF);
  });

  it("delegates to the counter once it is registered, with the ids and the manager it was given", async () => {
    const registry = new LessonCoverageRegistry();
    const answer = new Map([[LESSON_ID, staff(1, 2)]]);
    const counter = counterAnswering(answer);
    const manager = {} as EntityManager;
    registry.register(counter);

    const result = await registry.countConfirmedStaff([LESSON_ID, OTHER_LESSON_ID], manager);

    expect(result).toBe(answer);
    expect(counter.countConfirmedStaff).toHaveBeenCalledTimes(1);
    expect(counter.countConfirmedStaff).toHaveBeenCalledWith([LESSON_ID, OTHER_LESSON_ID], manager);
  });

  it("passes no manager when it gets none", async () => {
    const registry = new LessonCoverageRegistry();
    const counter = counterAnswering(new Map());
    registry.register(counter);

    await registry.countConfirmedStaff([LESSON_ID]);

    expect(counter.countConfirmedStaff).toHaveBeenCalledWith([LESSON_ID], undefined);
  });

  it("throws when a second counter is registered, and keeps the first one", async () => {
    const registry = new LessonCoverageRegistry();
    const first = counterAnswering(new Map([[LESSON_ID, staff(1, 0)]]));
    const second = counterAnswering(new Map([[LESSON_ID, staff(0, 9)]]));
    registry.register(first);

    expect(() => registry.register(second)).toThrow(
      "A lesson staff counter is already registered.",
    );

    await registry.countConfirmedStaff([LESSON_ID]);
    expect(first.countConfirmedStaff).toHaveBeenCalledTimes(1);
    expect(second.countConfirmedStaff).not.toHaveBeenCalled();
  });

  it("is itself a counter, so whoever asks it needs no other type", () => {
    const registry: LessonStaffCounter = new LessonCoverageRegistry();

    expect(typeof registry.countConfirmedStaff).toBe("function");
    expect(typeof registry.findConfirmedStaff).toBe("function");
  });

  describe("findConfirmedStaff", () => {
    const TEACHER = { id: "01999a3e-0000-7000-8000-0000000000b1", name: "Ana Torres" };

    it("answers an empty map when no counter is registered: no teacher is known as far as lessons know", async () => {
      const registry = new LessonCoverageRegistry();

      const result = await registry.findConfirmedStaff([LESSON_ID, OTHER_LESSON_ID]);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
      expect(result.get(LESSON_ID) ?? NO_CONFIRMED_STAFF).toBe(NO_CONFIRMED_STAFF);
    });

    it("delegates to the counter once it is registered, with the ids and with no manager: a plain read", async () => {
      const registry = new LessonCoverageRegistry();
      const found = new Map<string, ConfirmedStaff>([
        [LESSON_ID, { teachers: 1, monitors: 2, teacher: TEACHER }],
      ]);
      const counter = counterAnswering(new Map(), found);
      registry.register(counter);

      const result = await registry.findConfirmedStaff([LESSON_ID, OTHER_LESSON_ID]);

      expect(result).toBe(found);
      expect(counter.findConfirmedStaff).toHaveBeenCalledTimes(1);
      expect(counter.findConfirmedStaff).toHaveBeenCalledWith([LESSON_ID, OTHER_LESSON_ID]);
    });

    it("asks the counter only for what was asked: the other read is not called", async () => {
      const registry = new LessonCoverageRegistry();
      const counter = counterAnswering(new Map());
      registry.register(counter);

      await registry.findConfirmedStaff([LESSON_ID]);
      expect(counter.countConfirmedStaff).not.toHaveBeenCalled();

      await registry.countConfirmedStaff([LESSON_ID]);
      expect(counter.findConfirmedStaff).toHaveBeenCalledTimes(1);
    });

    it("keeps the first counter when a second one is registered: both reads go to it", async () => {
      const registry = new LessonCoverageRegistry();
      const first = counterAnswering(new Map());
      const second = counterAnswering(new Map());
      registry.register(first);
      expect(() => registry.register(second)).toThrow();

      await registry.findConfirmedStaff([LESSON_ID]);

      expect(first.findConfirmedStaff).toHaveBeenCalledTimes(1);
      expect(second.findConfirmedStaff).not.toHaveBeenCalled();
    });
  });
});
