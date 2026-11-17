import { StudentAttendanceStatus } from "../enums/student-attendance-status.enum";
import { attendanceRatesOf, rateOf, rollCallCountsOf } from "../services/student-attendance-stats";

const CLASS_A = "01999a3e-7c1b-7000-8000-0000000000c1";
const CLASS_B = "01999a3e-7c1b-7000-8000-0000000000c2";
const LESSON_1 = "01999a3e-7c1b-7000-8000-0000000000f1";
const LESSON_2 = "01999a3e-7c1b-7000-8000-0000000000f2";
const LESSON_3 = "01999a3e-7c1b-7000-8000-0000000000f3";
const ANA = "01999a3e-7c1b-7000-8000-000000000e01";
const BRUNO = "01999a3e-7c1b-7000-8000-000000000e02";
const CARLA = "01999a3e-7c1b-7000-8000-000000000e03";

const PRESENT = StudentAttendanceStatus.PRESENT;
const ABSENT = StudentAttendanceStatus.ABSENT;

function recorded(enrollmentId: string, lessonId: string, status: StudentAttendanceStatus) {
  return { enrollmentId, lessonId, status };
}

describe("attendanceRatesOf", () => {
  it("answers presences over the recorded roll calls of each enrollment, with two decimals", () => {
    const rates = attendanceRatesOf(
      [
        recorded(ANA, LESSON_1, PRESENT),
        recorded(ANA, LESSON_2, PRESENT),
        recorded(ANA, LESSON_3, ABSENT),
        recorded(BRUNO, LESSON_1, PRESENT),
        recorded(BRUNO, LESSON_2, ABSENT),
        recorded(BRUNO, LESSON_3, ABSENT),
      ],
      new Set(),
    );

    expect(rates).toEqual(
      new Map([
        [ANA, 0.67],
        [BRUNO, 0.33],
      ]),
    );
  });

  it("counts a justified absence as an absence", () => {
    // The justification is a column of its own: the row says absent, and that is what counts.
    expect(
      attendanceRatesOf(
        [recorded(ANA, LESSON_1, PRESENT), recorded(ANA, LESSON_2, ABSENT)],
        new Set(),
      ).get(ANA),
    ).toBe(0.5);
  });

  it("leaves out the roll calls of cancelled lessons, and an enrollment left without any", () => {
    const rates = attendanceRatesOf(
      [
        recorded(ANA, LESSON_1, PRESENT),
        recorded(ANA, LESSON_2, ABSENT),
        recorded(BRUNO, LESSON_2, PRESENT),
      ],
      new Set([LESSON_2]),
    );

    expect(rates).toEqual(new Map([[ANA, 1]]));
    expect(rates.has(BRUNO)).toBe(false);
    expect(rates.has(CARLA)).toBe(false);
  });

  it("answers 1 for all present and 0 for all absent", () => {
    const rates = attendanceRatesOf(
      [
        recorded(ANA, LESSON_1, PRESENT),
        recorded(ANA, LESSON_2, PRESENT),
        recorded(BRUNO, LESSON_1, ABSENT),
        recorded(BRUNO, LESSON_2, ABSENT),
      ],
      new Set(),
    );

    expect(rates.get(ANA)).toBe(1);
    expect(rates.get(BRUNO)).toBe(0);
  });

  it("throws on a status it does not know instead of counting it", () => {
    const unknown = { enrollmentId: ANA, lessonId: LESSON_1, status: "late" };

    expect(() =>
      attendanceRatesOf([unknown as unknown as ReturnType<typeof recorded>], new Set()),
    ).toThrow("Unknown student attendance status");
  });
});

describe("rateOf", () => {
  it("rounds to two decimals and refuses a rate without a recorded roll call", () => {
    expect(rateOf(1, 3)).toBe(0.33);
    expect(rateOf(3, 4)).toBe(0.75);
    expect(() => rateOf(0, 0)).toThrow("at least one recorded roll call");
    expect(() => rateOf(1, 0.5)).toThrow("at least one recorded roll call");
  });
});

describe("rollCallCountsOf", () => {
  const lesson1 = { id: LESSON_1, classId: CLASS_A, date: "2026-03-10" };

  it("counts total as the expected enrollments plus the signed ones outside them, and signed as the signatures of the lesson", () => {
    const counts = rollCallCountsOf(
      [lesson1],
      [
        { classId: CLASS_A, date: "2026-03-10", enrollmentId: ANA },
        { classId: CLASS_A, date: "2026-03-10", enrollmentId: BRUNO },
      ],
      [
        { lessonId: LESSON_1, enrollmentId: ANA },
        // Dropped before the day, but signed: in the roll call too.
        { lessonId: LESSON_1, enrollmentId: CARLA },
      ],
    );

    expect(counts).toEqual(new Map([[LESSON_1, { total: 3, signed: 2 }]]));
  });

  it("keeps the roll call pending when an expected student has no signature, even with a retroactive drop signed", () => {
    const counts = rollCallCountsOf(
      [lesson1],
      [
        { classId: CLASS_A, date: "2026-03-10", enrollmentId: ANA },
        { classId: CLASS_A, date: "2026-03-10", enrollmentId: BRUNO },
      ],
      [
        { lessonId: LESSON_1, enrollmentId: ANA },
        { lessonId: LESSON_1, enrollmentId: CARLA },
      ],
    );

    const count = counts.get(LESSON_1);
    // Two signatures for two expected students, yet Bruno is missing: signed stays below total.
    expect(count?.signed).toBeLessThan(count?.total ?? 0);
  });

  it("shares the expected enrollments of two lessons of the same class on the same day", () => {
    const counts = rollCallCountsOf(
      [
        lesson1,
        { id: LESSON_2, classId: CLASS_A, date: "2026-03-10" },
        { id: LESSON_3, classId: CLASS_B, date: "2026-03-10" },
        lesson1,
      ],
      [
        { classId: CLASS_A, date: "2026-03-10", enrollmentId: ANA },
        { classId: CLASS_A, date: "2026-03-10", enrollmentId: BRUNO },
        { classId: CLASS_B, date: "2026-03-10", enrollmentId: CARLA },
      ],
      [{ lessonId: LESSON_2, enrollmentId: BRUNO }],
    );

    expect(counts).toEqual(
      new Map([
        [LESSON_1, { total: 2, signed: 0 }],
        [LESSON_2, { total: 2, signed: 1 }],
        [LESSON_3, { total: 1, signed: 0 }],
      ]),
    );
  });

  it("leaves out a lesson with total 0", () => {
    const counts = rollCallCountsOf(
      [lesson1, { id: LESSON_2, classId: CLASS_A, date: "2026-03-17" }],
      [{ classId: CLASS_A, date: "2026-03-10", enrollmentId: ANA }],
      [],
    );

    expect([...counts.keys()]).toEqual([LESSON_1]);
  });
});
