import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { EnrollmentRosterService } from "@modules/classes/services/enrollment-roster.service";
import { LessonRollCallRegistry } from "@modules/lessons/services/lesson-roll-call.registry";
import { StudentRollCallCounterService } from "../services/student-roll-call-counter.service";

const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const LESSON_1 = "01999a3e-7c1b-7000-8000-0000000000f1";
const LESSON_2 = "01999a3e-7c1b-7000-8000-0000000000f2";
const ANA = "01999a3e-7c1b-7000-8000-000000000e01";
const BRUNO = "01999a3e-7c1b-7000-8000-000000000e02";

describe("StudentRollCallCounterService", () => {
  let counter: StudentRollCallCounterService;

  const plainManager = { query: jest.fn() };
  const transaction = { query: jest.fn() };
  const dataSource = { manager: plainManager };
  const registry = { register: jest.fn() };
  const roster = { findRosterIds: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    roster.findRosterIds.mockResolvedValue([
      { classId: CLASS_ID, date: "2026-03-10", enrollmentId: ANA },
      { classId: CLASS_ID, date: "2026-03-10", enrollmentId: BRUNO },
    ]);
    transaction.query.mockResolvedValue([{ lessonId: LESSON_1, enrollmentId: ANA }]);
    plainManager.query.mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        StudentRollCallCounterService,
        { provide: DataSource, useValue: dataSource },
        { provide: LessonRollCallRegistry, useValue: registry },
        { provide: EnrollmentRosterService, useValue: roster },
      ],
    }).compile();

    counter = moduleRef.get(StudentRollCallCounterService);
  });

  it("registers itself in the LessonRollCallRegistry when the module starts", () => {
    counter.onModuleInit();

    expect(registry.register).toHaveBeenCalledWith(counter);
  });

  it("answers an empty map without querying for no lesson", async () => {
    await expect(counter.countStudentRollCalls([])).resolves.toEqual(new Map());
    await expect(
      counter.countStudentRollCalls([{ id: "not-a-uuid", classId: CLASS_ID, date: "2026-03-10" }]),
    ).resolves.toEqual(new Map());

    expect(roster.findRosterIds).not.toHaveBeenCalled();
    expect(plainManager.query).not.toHaveBeenCalled();
  });

  it("reads the roster once for every class and day and the signatures once, with the manager it is given and without a lock", async () => {
    const lessons = [
      { id: LESSON_1, classId: CLASS_ID, date: "2026-03-10" },
      { id: LESSON_2, classId: CLASS_ID, date: "2026-03-10" },
      { id: LESSON_1, classId: CLASS_ID, date: "2026-03-10" },
    ];

    const counts = await counter.countStudentRollCalls(lessons, transaction as never);

    expect(roster.findRosterIds).toHaveBeenCalledTimes(1);
    expect(roster.findRosterIds).toHaveBeenCalledWith(
      lessons.map((lesson) => ({ classId: lesson.classId, date: lesson.date })),
      transaction,
    );
    expect(transaction.query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = transaction.query.mock.calls[0];
    expect(sql).toContain("FROM student_attendance");
    expect(sql).toContain("deleted_at IS NULL");
    expect(sql).not.toMatch(/\bFOR\s+(UPDATE|SHARE)\b/i);
    expect(parameters).toEqual([[LESSON_1, LESSON_2]]);
    expect(plainManager.query).not.toHaveBeenCalled();
    expect(counts).toEqual(
      new Map([
        [LESSON_1, { total: 2, signed: 1 }],
        [LESSON_2, { total: 2, signed: 0 }],
      ]),
    );

    // Without a manager, a plain read.
    await counter.countStudentRollCalls(lessons);
    expect(roster.findRosterIds).toHaveBeenLastCalledWith(expect.any(Array), undefined);
    expect(plainManager.query).toHaveBeenCalledTimes(1);
  });
});
