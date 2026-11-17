import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { DataSource, EntityManager } from "typeorm";
import { EnrollmentAttendanceRegistry } from "@modules/classes/services/enrollment-attendance.registry";
import { LessonsService, LessonStatus } from "@modules/lessons/services/lessons.service";
import { EnrollmentAttendanceReaderService } from "../services/enrollment-attendance-reader.service";

const ANA = "01999a3e-7c1b-7000-8000-000000000e01";
const BRUNO = "01999a3e-7c1b-7000-8000-000000000e02";
const LESSON_1 = "01999a3e-7c1b-7000-8000-0000000000f1";
const LESSON_2 = "01999a3e-7c1b-7000-8000-0000000000f2";

function summaryOf(id: string, status: LessonStatus) {
  return {
    id,
    classId: "01999a3e-7c1b-7000-8000-0000000000c1",
    title: "Aula",
    date: "2026-03-10",
    startTime: "09:00",
    endTime: "11:00",
    status,
    expectedMonitors: null,
  };
}

describe("EnrollmentAttendanceReaderService", () => {
  let reader: EnrollmentAttendanceReaderService;

  const dataSource = { query: jest.fn() };
  const registry = { register: jest.fn() };
  const lessons = { findLessonSummaries: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    dataSource.query.mockResolvedValue([
      { enrollmentId: ANA, lessonId: LESSON_1, status: "present" },
      { enrollmentId: ANA, lessonId: LESSON_2, status: "absent" },
      { enrollmentId: BRUNO, lessonId: LESSON_1, status: "absent" },
      { enrollmentId: BRUNO, lessonId: LESSON_2, status: "present" },
    ]);
    lessons.findLessonSummaries.mockResolvedValue([
      summaryOf(LESSON_1, LessonStatus.DONE),
      summaryOf(LESSON_2, LessonStatus.CANCELLED),
    ]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        EnrollmentAttendanceReaderService,
        { provide: DataSource, useValue: dataSource },
        { provide: EnrollmentAttendanceRegistry, useValue: registry },
        { provide: LessonsService, useValue: lessons },
      ],
    }).compile();

    reader = moduleRef.get(EnrollmentAttendanceReaderService);
  });

  it("registers itself in the EnrollmentAttendanceRegistry when the module starts", () => {
    reader.onModuleInit();

    expect(registry.register).toHaveBeenCalledWith(reader);
  });

  it("answers an empty map without querying for no valid id", async () => {
    await expect(reader.attendanceRates([])).resolves.toEqual(new Map());
    await expect(reader.attendanceRates(["not-a-uuid"])).resolves.toEqual(new Map());

    expect(dataSource.query).not.toHaveBeenCalled();
    expect(lessons.findLessonSummaries).not.toHaveBeenCalled();
  });

  it("reads the signatures once and the lessons once (findLessonSummaries) for the whole page", async () => {
    const rates = await reader.attendanceRates([ANA, BRUNO, ANA.toUpperCase(), "not-a-uuid"]);

    expect(dataSource.query).toHaveBeenCalledTimes(1);
    const [sql, parameters] = dataSource.query.mock.calls[0];
    expect(sql).toContain("FROM student_attendance");
    expect(sql).toContain("deleted_at IS NULL");
    expect(sql).not.toMatch(/\bFOR\s+(UPDATE|SHARE)\b/i);
    expect(parameters).toEqual([[ANA, BRUNO]]);
    expect(lessons.findLessonSummaries).toHaveBeenCalledTimes(1);
    expect(lessons.findLessonSummaries).toHaveBeenCalledWith([LESSON_1, LESSON_2]);
    // The cancelled lesson leaves both sides of the rate.
    expect(rates).toEqual(
      new Map([
        [ANA, 1],
        [BRUNO, 0],
      ]),
    );

    // No signature at all: no lesson to read.
    dataSource.query.mockResolvedValue([]);
    lessons.findLessonSummaries.mockClear();
    await expect(reader.attendanceRates([ANA])).resolves.toEqual(new Map());
    expect(lessons.findLessonSummaries).not.toHaveBeenCalled();
  });

  it("counts the attendance of an enrollment with the manager it is given, without a lock", async () => {
    const manager = { query: jest.fn().mockResolvedValue([{ count: 3 }]) };

    await expect(reader.countAttendance(manager as unknown as EntityManager, ANA)).resolves.toBe(3);
    const [sql, parameters] = manager.query.mock.calls[0];
    expect(sql).toContain("COUNT(*)::int");
    expect(sql).toContain("deleted_at IS NULL");
    expect(sql).not.toMatch(/\bFOR\s+(UPDATE|SHARE)\b/i);
    expect(parameters).toEqual([ANA]);
    expect(dataSource.query).not.toHaveBeenCalled();

    manager.query.mockClear();
    await expect(
      reader.countAttendance(manager as unknown as EntityManager, "not-a-uuid"),
    ).resolves.toBe(0);
    expect(manager.query).not.toHaveBeenCalled();
  });
});
