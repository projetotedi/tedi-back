import { LessonStatus } from "@modules/lessons/services/lessons.service";
import { AssignmentSource } from "../enums/assignment-source.enum";
import { AssignmentStatus } from "../enums/assignment-status.enum";
import { isExpiredApplication, statusAsOf } from "../services/assignment-status";

const TODAY = "2026-03-10";

function lesson(date: string, status: LessonStatus = LessonStatus.PLANNED) {
  return { date, status };
}

const PENDING_APPLICATION = {
  status: AssignmentStatus.PENDING,
  source: AssignmentSource.APPLICATION,
};

describe("isExpiredApplication (GUS-179)", () => {
  it("is true for a pending application of a lesson before today, whatever its status", () => {
    for (const status of [LessonStatus.PLANNED, LessonStatus.CONFIRMED, LessonStatus.DONE]) {
      expect(isExpiredApplication(PENDING_APPLICATION, lesson("2026-03-09", status), TODAY)).toBe(
        true,
      );
    }
  });

  it("is false on the day of the lesson and after it, even for a lesson already done", () => {
    expect(isExpiredApplication(PENDING_APPLICATION, lesson(TODAY), TODAY)).toBe(false);
    expect(isExpiredApplication(PENDING_APPLICATION, lesson(TODAY, LessonStatus.DONE), TODAY)).toBe(
      false,
    );
    expect(isExpiredApplication(PENDING_APPLICATION, lesson("2026-03-11"), TODAY)).toBe(false);
  });

  it("is true for a pending application of a cancelled lesson, of any day", () => {
    expect(
      isExpiredApplication(
        PENDING_APPLICATION,
        lesson("2026-03-20", LessonStatus.CANCELLED),
        TODAY,
      ),
    ).toBe(true);
  });

  it("is false for a pending direct assignment: it is still confirmed after the lesson (A12)", () => {
    const direct = { status: AssignmentStatus.PENDING, source: AssignmentSource.DIRECT };

    expect(isExpiredApplication(direct, lesson("2026-03-01"), TODAY)).toBe(false);
    expect(isExpiredApplication(direct, lesson(TODAY, LessonStatus.CANCELLED), TODAY)).toBe(false);
  });

  it.each([
    AssignmentStatus.CONFIRMED,
    AssignmentStatus.DECLINED,
    AssignmentStatus.CANCELLED,
    AssignmentStatus.EXPIRED,
  ])("is false for an application that is %s: only a pending one expires", (status) => {
    const application = { status, source: AssignmentSource.APPLICATION };

    expect(isExpiredApplication(application, lesson("2026-03-01"), TODAY)).toBe(false);
  });
});

describe("statusAsOf (GUS-179)", () => {
  it("answers expired for a pending application that expired with its lesson", () => {
    expect(statusAsOf(PENDING_APPLICATION, lesson("2026-03-09"), TODAY)).toBe(
      AssignmentStatus.EXPIRED,
    );
  });

  it("answers the stored status otherwise", () => {
    expect(statusAsOf(PENDING_APPLICATION, lesson(TODAY), TODAY)).toBe(AssignmentStatus.PENDING);
    expect(
      statusAsOf(
        { status: AssignmentStatus.CONFIRMED, source: AssignmentSource.APPLICATION },
        lesson("2026-03-09"),
        TODAY,
      ),
    ).toBe(AssignmentStatus.CONFIRMED);
    expect(
      statusAsOf(
        { status: AssignmentStatus.EXPIRED, source: AssignmentSource.APPLICATION },
        lesson("2026-03-20", LessonStatus.CANCELLED),
        TODAY,
      ),
    ).toBe(AssignmentStatus.EXPIRED);
  });
});
