import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DataSource, In } from "typeorm";
import { ClassRef, ClassesService } from "@modules/classes/services/classes.service";
import { LessonsCalendarQueryDto } from "../dto/calendar-query.dto";
import { ListLessonsQueryDto } from "../dto/list-lessons-query.dto";
import { Lesson } from "../entities/lesson.entity";
import { LessonStatus } from "../enums/lesson-status.enum";
import { ConfirmedStaff } from "../services/lesson-coverage";
import { LessonCoverageRegistry } from "../services/lesson-coverage.registry";
import { LessonListingService } from "../services/lesson-listing.service";

const ACTOR_ID = "01999a3e-0000-7000-8000-0000000000aa";
const CLASS_A_ID = "01999a3e-7c1b-7000-8000-0000000000a1";
const CLASS_B_ID = "01999a3e-7c1b-7000-8000-0000000000b1";
const COURSE_ID = "01999a3e-7c1b-7000-8000-000000000001";
const PLAN_ID = "01999a3e-7c1b-7000-8000-000000000011";
const TEACHER = { id: "01999a3e-0000-7000-8000-0000000000b1", name: "Ana Torres" };
const OTHER_TEACHER = { id: "01999a3e-0000-7000-8000-0000000000b2", name: "Bruno Lima" };

function lessonId(n: number): string {
  return `01999a3e-7c1b-7000-8000-${String(n).padStart(12, "0")}`;
}

function buildClassRef(overrides: Partial<ClassRef> = {}): ClassRef {
  return {
    id: CLASS_A_ID,
    code: "INFO-A",
    name: "Informática Básica, turma A",
    courseId: COURSE_ID,
    archivedAt: null,
    creationRank: 1,
    ...overrides,
  };
}

function buildLesson(overrides: Partial<Lesson> = {}): Lesson {
  return Object.assign(new Lesson(), {
    id: "01999a3e-7c1b-7000-8000-0000000000f1",
    classId: CLASS_A_ID,
    lessonPlanId: null,
    sequenceOrder: null,
    title: "Senhas e privacidade",
    objective: null,
    date: "2026-03-10",
    startTime: "14:00",
    endTime: "15:30",
    location: null,
    expectedStudents: null,
    expectedMonitors: null,
    subject: null,
    postNotes: null,
    status: LessonStatus.PLANNED,
    cancelReason: null,
    cancelledAt: null,
    cancelledById: null,
    originalDate: null,
    rescheduleReason: null,
    rescheduleNote: null,
    createdById: ACTOR_ID,
    createdAt: new Date("2026-03-01T12:00:00.000Z"),
    updatedAt: new Date("2026-03-01T12:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  });
}

/** The list takes the query as the ValidationPipe hands it over: strings and numbers, all optional. */
function listQuery(overrides: Partial<ListLessonsQueryDto> = {}): ListLessonsQueryDto {
  return Object.assign(new ListLessonsQueryDto(), overrides);
}

function calendarQuery(overrides: Partial<LessonsCalendarQueryDto> = {}): LessonsCalendarQueryDto {
  return Object.assign(new LessonsCalendarQueryDto(), {
    from: "2026-03-01",
    to: "2026-04-11",
    ...overrides,
  });
}

async function httpFailure(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return error as HttpException;
  }
  throw new Error("Expected the promise to reject with an HttpException");
}

/**
 * A query builder whose every step answers itself, as the real one does, so the calls can be read.
 * `clone` hands out a new one each time (recorded in `clones`): the page and the count of a list
 * are two different queries, and a test has to tell them apart.
 */
class FakeBuilder {
  readonly where = jest.fn<FakeBuilder, unknown[]>(() => this);
  readonly andWhere = jest.fn<FakeBuilder, unknown[]>(() => this);
  readonly orderBy = jest.fn<FakeBuilder, unknown[]>(() => this);
  readonly addOrderBy = jest.fn<FakeBuilder, unknown[]>(() => this);
  readonly offset = jest.fn<FakeBuilder, unknown[]>(() => this);
  readonly limit = jest.fn<FakeBuilder, unknown[]>(() => this);
  readonly getParameters = jest.fn(() => ({}));
  readonly getMany = jest.fn(async () => state.lessons);
  readonly getCount = jest.fn(async () => state.total);
  readonly clone = jest.fn(() => {
    const clone = new FakeBuilder();
    state.clones.push(clone);
    return clone;
  });
}

let state: { lessons: Lesson[]; total: number; clones: FakeBuilder[] };

describe("LessonListingService", () => {
  let service: LessonListingService;
  let base: FakeBuilder;

  const repository = { createQueryBuilder: jest.fn(), find: jest.fn() };
  const dataSource = { getRepository: jest.fn() };
  const classes = { listClassRefs: jest.fn() };
  const coverage = { findConfirmedStaff: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    state = { lessons: [buildLesson()], total: 1, clones: [] };
    base = new FakeBuilder();

    repository.createQueryBuilder.mockReturnValue(base);
    dataSource.getRepository.mockReturnValue(repository);
    classes.listClassRefs.mockResolvedValue([buildClassRef()]);
    // No counter registered, or nobody confirmed: the registry answers an empty map.
    coverage.findConfirmedStaff.mockResolvedValue(new Map());

    const moduleRef = await Test.createTestingModule({
      providers: [
        LessonListingService,
        { provide: DataSource, useValue: dataSource },
        { provide: ClassesService, useValue: classes },
        { provide: LessonCoverageRegistry, useValue: coverage },
      ],
    }).compile();

    service = moduleRef.get(LessonListingService);
  });

  /** What was asked of the lessons: every call to a step of the builder, in order. */
  function conditionsOf(builder: FakeBuilder): Array<[string, unknown]> {
    return [...builder.where.mock.calls, ...builder.andWhere.mock.calls].map(
      (call) => [call[0], call[1]] as [string, unknown],
    );
  }

  describe("list()", () => {
    describe("when no class matches", () => {
      beforeEach(() => {
        classes.listClassRefs.mockResolvedValue([]);
      });

      it("answers an empty page and does not query the lessons", async () => {
        await expect(service.list(listQuery())).resolves.toEqual({
          data: [],
          total: 0,
          page: 1,
          limit: 20,
        });

        expect(dataSource.getRepository).not.toHaveBeenCalled();
        expect(repository.createQueryBuilder).not.toHaveBeenCalled();
        expect(base.getMany).not.toHaveBeenCalled();
        expect(base.getCount).not.toHaveBeenCalled();
      });

      it("answers the page and the limit that were asked for, normalized", async () => {
        await expect(service.list(listQuery({ page: 3, limit: 10 }))).resolves.toEqual({
          data: [],
          total: 0,
          page: 3,
          limit: 10,
        });
        await expect(service.list(listQuery({ limit: 500 }))).resolves.toMatchObject({
          page: 1,
          limit: 100,
        });
      });
    });

    describe("the classes it asks for", () => {
      it("asks for the classes that are not archived when there is no classId", async () => {
        await service.list(listQuery());
        await service.list(listQuery({ courseId: COURSE_ID }));

        expect(classes.listClassRefs).toHaveBeenNthCalledWith(1, { includeArchived: false });
        expect(classes.listClassRefs).toHaveBeenNthCalledWith(2, {
          courseId: COURSE_ID,
          includeArchived: false,
        });
      });

      it("includes the archived classes only when the filter names a classId", async () => {
        await service.list(listQuery({ classId: CLASS_A_ID }));
        await service.list(listQuery({ classId: CLASS_A_ID, courseId: COURSE_ID }));

        expect(classes.listClassRefs).toHaveBeenNthCalledWith(1, {
          classId: CLASS_A_ID,
          includeArchived: true,
        });
        expect(classes.listClassRefs).toHaveBeenNthCalledWith(2, {
          classId: CLASS_A_ID,
          courseId: COURSE_ID,
          includeArchived: true,
        });
      });

      it("asks only once, whatever the filters", async () => {
        await service.list(
          listQuery({ classId: CLASS_A_ID, status: LessonStatus.DONE, search: "senhas" }),
        );

        expect(classes.listClassRefs).toHaveBeenCalledTimes(1);
      });
    });

    describe("the period", () => {
      it("answers 400 INVALID_DATE_RANGE when to is before from, before asking for any class", async () => {
        const failure = await httpFailure(
          service.list(listQuery({ from: "2026-04-11", to: "2026-03-01" })),
        );

        expect(failure.getStatus()).toBe(400);
        expect(failure.getResponse()).toMatchObject({
          error: "INVALID_DATE_RANGE",
          details: [{ field: "to", message: "to must be on or after from" }],
        });
        expect(classes.listClassRefs).not.toHaveBeenCalled();
        expect(dataSource.getRepository).not.toHaveBeenCalled();
      });

      it("takes from and to one at a time, and a period of one day", async () => {
        await service.list(listQuery({ from: "2026-03-01" }));
        await service.list(listQuery({ to: "2026-04-11" }));
        await service.list(listQuery({ from: "2026-03-10", to: "2026-03-10" }));

        expect(classes.listClassRefs).toHaveBeenCalledTimes(3);
      });

      it("does not limit how long the period is: the list is paginated", async () => {
        await service.list(listQuery({ from: "2020-01-01", to: "2026-12-31" }));

        expect(classes.listClassRefs).toHaveBeenCalledTimes(1);
        expect(base.where).toHaveBeenCalled();
      });
    });

    describe("the query", () => {
      it("reads the lessons through the repository of the data source, with no transaction", async () => {
        await service.list(listQuery());

        expect(dataSource.getRepository).toHaveBeenCalledWith(Lesson);
        expect(repository.createQueryBuilder).toHaveBeenCalledWith("lesson");
      });

      it("takes only the lessons of the classes it resolved, in the order of the classes", async () => {
        classes.listClassRefs.mockResolvedValue([
          buildClassRef({ id: CLASS_A_ID, creationRank: 1 }),
          buildClassRef({ id: CLASS_B_ID, code: "SEG-B", creationRank: 2 }),
        ]);

        await service.list(listQuery());

        expect(conditionsOf(base)).toEqual([
          ["lesson.classId IN (:...classIds)", { classIds: [CLASS_A_ID, CLASS_B_ID] }],
        ]);
      });

      it("adds a condition for each filter that was sent, and none for the others", async () => {
        await service.list(
          listQuery({
            status: LessonStatus.CANCELLED,
            lessonPlanId: PLAN_ID,
            from: "2026-03-01",
            to: "2026-04-11",
          }),
        );

        expect(conditionsOf(base)).toEqual([
          ["lesson.classId IN (:...classIds)", { classIds: [CLASS_A_ID] }],
          ["lesson.status = :status", { status: LessonStatus.CANCELLED }],
          ["lesson.lessonPlanId = :lessonPlanId", { lessonPlanId: PLAN_ID }],
          ["lesson.date >= :from", { from: "2026-03-01" }],
          ["lesson.date <= :to", { to: "2026-04-11" }],
        ]);
      });

      it("passes no status condition when the status is omitted: the cancelled lessons come too", async () => {
        await service.list(listQuery());

        expect(conditionsOf(base).map(([sql]) => sql)).toEqual([
          "lesson.classId IN (:...classIds)",
        ]);
      });

      it("searches for every word in the title or in the subject, one parameter per word", async () => {
        await service.list(listQuery({ search: "senhas  privacidade" }));

        const search = base.andWhere.mock.calls.find((call) =>
          String(call[0]).includes("lessonSearch0"),
        );
        expect(search).toBeDefined();
        const [sql, parameters] = search as unknown as [string, Record<string, string>];
        expect(parameters).toEqual({ lessonSearch0: "%senhas%", lessonSearch1: "%privacidade%" });
        expect(sql).toContain("public.search_normalize(lesson.title)");
        expect(sql).toContain("public.search_normalize(lesson.subject)");
        expect(sql).toContain("lessonSearch1");
        expect(sql).toContain(" AND ");
      });

      it("adds no search condition for a blank search", async () => {
        await service.list(listQuery({ search: "   " }));
        await service.list(listQuery({ search: "" }));

        for (const call of base.andWhere.mock.calls) {
          expect(String(call[0])).not.toContain("search_normalize");
        }
      });

      it("orders by date, start time and id, ascending, so a page never repeats a lesson", async () => {
        await service.list(listQuery());

        expect(base.orderBy).toHaveBeenCalledWith("lesson.date", "ASC");
        expect(base.addOrderBy.mock.calls).toEqual([
          ["lesson.startTime", "ASC"],
          ["lesson.id", "ASC"],
        ]);
      });
    });

    describe("the page", () => {
      it("asks for the first 20 lessons by default, and counts the same query without a page", async () => {
        await service.list(listQuery());

        expect(state.clones).toHaveLength(2);
        const [pageQuery, countQuery] = state.clones;
        expect(pageQuery.offset).toHaveBeenCalledWith(0);
        expect(pageQuery.limit).toHaveBeenCalledWith(20);
        expect(pageQuery.getMany).toHaveBeenCalledTimes(1);
        expect(pageQuery.getCount).not.toHaveBeenCalled();
        expect(countQuery.getCount).toHaveBeenCalledTimes(1);
        expect(countQuery.getMany).not.toHaveBeenCalled();
        expect(countQuery.offset).not.toHaveBeenCalled();
        expect(countQuery.limit).not.toHaveBeenCalled();
      });

      it("skips the lessons of the pages before it: page 3 of 10 starts at 20", async () => {
        await service.list(listQuery({ page: 3, limit: 10 }));

        expect(state.clones[0].offset).toHaveBeenCalledWith(20);
        expect(state.clones[0].limit).toHaveBeenCalledWith(10);
      });

      it("takes at most 100 lessons a page, whatever the limit asked", async () => {
        await service.list(listQuery({ limit: 500 }));

        expect(state.clones[0].limit).toHaveBeenCalledWith(100);
      });

      it("builds the page with the class of each lesson, the total of the count and the page asked", async () => {
        classes.listClassRefs.mockResolvedValue([
          buildClassRef({ id: CLASS_A_ID, code: "INFO-A", creationRank: 1 }),
          buildClassRef({ id: CLASS_B_ID, code: "SEG-B", name: null, creationRank: 9 }),
        ]);
        state.lessons = [
          buildLesson({ id: "01999a3e-7c1b-7000-8000-0000000000f1", classId: CLASS_A_ID }),
          buildLesson({
            id: "01999a3e-7c1b-7000-8000-0000000000f2",
            classId: CLASS_B_ID,
            title: "Navegação segura",
            date: "2026-03-11",
            startTime: "08:00",
            endTime: "09:30",
            status: LessonStatus.CANCELLED,
            cancelledAt: new Date("2026-03-09T12:00:00.000Z"),
            cancelledById: ACTOR_ID,
          }),
        ];
        state.total = 27;

        const page = await service.list(listQuery({ page: 2, limit: 2 }));

        expect(page.total).toBe(27);
        expect(page.page).toBe(2);
        expect(page.limit).toBe(2);
        expect(page.data).toEqual([
          {
            id: "01999a3e-7c1b-7000-8000-0000000000f1",
            class: {
              id: CLASS_A_ID,
              code: "INFO-A",
              name: "Informática Básica, turma A",
              colorIndex: 0,
            },
            date: "2026-03-10",
            startTime: "14:00",
            endTime: "15:30",
            title: "Senhas e privacidade",
            status: LessonStatus.PLANNED,
            teacher: null,
            belowExpectedMonitors: false,
          },
          {
            id: "01999a3e-7c1b-7000-8000-0000000000f2",
            class: { id: CLASS_B_ID, code: "SEG-B", name: "SEG-B", colorIndex: 0 },
            date: "2026-03-11",
            startTime: "08:00",
            endTime: "09:30",
            title: "Navegação segura",
            status: LessonStatus.CANCELLED,
            teacher: null,
            belowExpectedMonitors: false,
          },
        ]);
      });

      it("answers an empty page, with the total of the count, when the page is past the last one", async () => {
        state.lessons = [];
        state.total = 25;

        await expect(service.list(listQuery({ page: 9, limit: 10 }))).resolves.toEqual({
          data: [],
          total: 25,
          page: 9,
          limit: 10,
        });
      });

      it("throws, instead of guessing, when a lesson comes from a class that was not resolved", async () => {
        state.lessons = [buildLesson({ classId: CLASS_B_ID })];

        await expect(service.list(listQuery())).rejects.toThrow("was not resolved");
      });
    });

    describe("the staff of the page (GUS-158)", () => {
      /** A page of `size` lessons of the class A, with their ids in order. */
      function pageOf(size: number): Lesson[] {
        return Array.from({ length: size }, (_, index) =>
          buildLesson({ id: lessonId(index + 1), title: `Aula ${index + 1}` }),
        );
      }

      it("asks the registry ONCE for the whole page, with the ids of its lessons in the order of the page", async () => {
        state.lessons = pageOf(3);

        await service.list(listQuery());

        expect(coverage.findConfirmedStaff).toHaveBeenCalledTimes(1);
        expect(coverage.findConfirmedStaff).toHaveBeenCalledWith([
          lessonId(1),
          lessonId(2),
          lessonId(3),
        ]);
      });

      it("costs one call for a full page, not one per lesson: 100 lessons, one call", async () => {
        state.lessons = pageOf(100);

        const page = await service.list(listQuery({ limit: 100 }));

        expect(page.data).toHaveLength(100);
        expect(coverage.findConfirmedStaff).toHaveBeenCalledTimes(1);
        expect(coverage.findConfirmedStaff.mock.calls[0][0]).toHaveLength(100);
      });

      it("asks for the lessons of the page and not for the ones of the count: after the page was read", async () => {
        state.lessons = pageOf(2);
        state.total = 57;

        await service.list(listQuery({ page: 2, limit: 2 }));

        expect(coverage.findConfirmedStaff).toHaveBeenCalledWith([lessonId(1), lessonId(2)]);
        const [pageQuery] = state.clones;
        expect(pageQuery.getMany.mock.invocationCallOrder[0]).toBeLessThan(
          coverage.findConfirmedStaff.mock.invocationCallOrder[0],
        );
      });

      it("fills the teacher and belowExpectedMonitors of each item from the staff of its own lesson", async () => {
        state.lessons = [
          buildLesson({ id: lessonId(1), expectedMonitors: 2 }),
          buildLesson({ id: lessonId(2), expectedMonitors: 2 }),
          buildLesson({ id: lessonId(3), expectedMonitors: null }),
        ];
        coverage.findConfirmedStaff.mockResolvedValue(
          new Map<string, ConfirmedStaff>([
            [lessonId(1), { teachers: 1, monitors: 1, teacher: TEACHER }],
            [lessonId(2), { teachers: 1, monitors: 2, teacher: OTHER_TEACHER }],
            [lessonId(3), { teachers: 0, monitors: 0, teacher: null }],
          ]),
        );

        const page = await service.list(listQuery());

        expect(
          page.data.map((item) => [item.id, item.teacher, item.belowExpectedMonitors]),
        ).toEqual([
          [lessonId(1), TEACHER, true],
          [lessonId(2), OTHER_TEACHER, false],
          [lessonId(3), null, false],
        ]);
      });

      it("reads a lesson that the registry does not list as a lesson with nobody confirmed", async () => {
        state.lessons = [
          buildLesson({ id: lessonId(1), expectedMonitors: 3 }),
          buildLesson({ id: lessonId(2), expectedMonitors: null }),
        ];

        const page = await service.list(listQuery());

        // Nobody is confirmed, so the three monitors the first one expects are all missing.
        expect(page.data.map((item) => [item.teacher, item.belowExpectedMonitors])).toEqual([
          [null, true],
          [null, false],
        ]);
      });

      it("keeps the order of the page, whatever the order the registry answers in", async () => {
        state.lessons = pageOf(3);
        coverage.findConfirmedStaff.mockResolvedValue(
          new Map<string, ConfirmedStaff>([
            [lessonId(3), { teachers: 1, monitors: 0, teacher: OTHER_TEACHER }],
            [lessonId(1), { teachers: 1, monitors: 0, teacher: TEACHER }],
          ]),
        );

        const page = await service.list(listQuery());

        expect(page.data.map((item) => item.id)).toEqual([lessonId(1), lessonId(2), lessonId(3)]);
        expect(page.data.map((item) => item.teacher?.name ?? null)).toEqual([
          "Ana Torres",
          null,
          "Bruno Lima",
        ]);
      });

      it("shows no belowExpectedMonitors for a cancelled lesson, and keeps its confirmed teacher", async () => {
        state.lessons = [
          buildLesson({
            id: lessonId(1),
            expectedMonitors: 2,
            status: LessonStatus.CANCELLED,
            cancelledAt: new Date("2026-03-09T12:00:00.000Z"),
            cancelledById: ACTOR_ID,
          }),
        ];
        coverage.findConfirmedStaff.mockResolvedValue(
          new Map<string, ConfirmedStaff>([
            [lessonId(1), { teachers: 1, monitors: 0, teacher: TEACHER }],
          ]),
        );

        const [item] = (await service.list(listQuery())).data;

        expect(item.belowExpectedMonitors).toBe(false);
        expect(item.teacher).toEqual(TEACHER);
      });

      it("does not ask the registry when no class matches: no lesson is read", async () => {
        classes.listClassRefs.mockResolvedValue([]);

        await service.list(listQuery());

        expect(coverage.findConfirmedStaff).not.toHaveBeenCalled();
      });

      it("does not ask the registry for an empty page: there is nobody to ask about", async () => {
        state.lessons = [];
        state.total = 25;

        await service.list(listQuery({ page: 9, limit: 10 }));

        expect(coverage.findConfirmedStaff).not.toHaveBeenCalled();
      });

      it("does not ask the registry when the period is not valid: nothing is read before that", async () => {
        await httpFailure(service.list(listQuery({ from: "2026-04-11", to: "2026-03-01" })));

        expect(coverage.findConfirmedStaff).not.toHaveBeenCalled();
      });

      it("fails the page when the registry fails, instead of answering rows with made-up staff", async () => {
        coverage.findConfirmedStaff.mockRejectedValue(new Error("boom"));

        await expect(service.list(listQuery())).rejects.toThrow("boom");
      });
    });
  });

  describe("listCalendar()", () => {
    describe("when no class matches", () => {
      it("answers an empty list and does not query the lessons", async () => {
        classes.listClassRefs.mockResolvedValue([]);

        await expect(service.listCalendar(calendarQuery())).resolves.toEqual([]);

        expect(dataSource.getRepository).not.toHaveBeenCalled();
        expect(base.getMany).not.toHaveBeenCalled();
      });
    });

    describe("the classes it asks for", () => {
      it("asks for the classes that are not archived when there is no classId", async () => {
        await service.listCalendar(calendarQuery());
        await service.listCalendar(calendarQuery({ courseId: COURSE_ID }));

        expect(classes.listClassRefs).toHaveBeenNthCalledWith(1, { includeArchived: false });
        expect(classes.listClassRefs).toHaveBeenNthCalledWith(2, {
          courseId: COURSE_ID,
          includeArchived: false,
        });
      });

      it("includes the archived classes only when the filter names a classId", async () => {
        await service.listCalendar(calendarQuery({ classId: CLASS_A_ID }));

        expect(classes.listClassRefs).toHaveBeenCalledWith({
          classId: CLASS_A_ID,
          includeArchived: true,
        });
      });
    });

    describe("the period", () => {
      it("answers 400 INVALID_DATE_RANGE when to is before from, before asking for any class", async () => {
        const failure = await httpFailure(
          service.listCalendar(calendarQuery({ from: "2026-04-11", to: "2026-03-01" })),
        );

        expect(failure.getStatus()).toBe(400);
        expect(failure.getResponse()).toMatchObject({ error: "INVALID_DATE_RANGE" });
        expect(classes.listClassRefs).not.toHaveBeenCalled();
        expect(dataSource.getRepository).not.toHaveBeenCalled();
      });

      it("answers 400 DATE_RANGE_TOO_LONG for 43 days, before asking for any class", async () => {
        const failure = await httpFailure(
          service.listCalendar(calendarQuery({ from: "2026-03-01", to: "2026-04-12" })),
        );

        expect(failure.getStatus()).toBe(400);
        expect(failure.getResponse()).toMatchObject({
          error: "DATE_RANGE_TOO_LONG",
          details: [{ field: "to", message: "to must be at most 41 days after from" }],
        });
        expect(classes.listClassRefs).not.toHaveBeenCalled();
        expect(dataSource.getRepository).not.toHaveBeenCalled();
      });

      it("accepts 42 days, a month grid, and a single day", async () => {
        await service.listCalendar(calendarQuery({ from: "2026-03-01", to: "2026-04-11" }));
        await service.listCalendar(calendarQuery({ from: "2026-03-10", to: "2026-03-10" }));

        expect(classes.listClassRefs).toHaveBeenCalledTimes(2);
      });
    });

    describe("the query", () => {
      it("asks for every lesson of the period in one query: no clone, no offset, no limit, no count", async () => {
        await service.listCalendar(calendarQuery());

        expect(base.getMany).toHaveBeenCalledTimes(1);
        expect(base.clone).not.toHaveBeenCalled();
        expect(base.offset).not.toHaveBeenCalled();
        expect(base.limit).not.toHaveBeenCalled();
        expect(base.getCount).not.toHaveBeenCalled();
        expect(repository.createQueryBuilder).toHaveBeenCalledTimes(1);
      });

      it("adds the same conditions as the list, with both ends of the period", async () => {
        await service.listCalendar(
          calendarQuery({ status: LessonStatus.PLANNED, lessonPlanId: PLAN_ID }),
        );

        expect(conditionsOf(base)).toEqual([
          ["lesson.classId IN (:...classIds)", { classIds: [CLASS_A_ID] }],
          ["lesson.status = :status", { status: LessonStatus.PLANNED }],
          ["lesson.lessonPlanId = :lessonPlanId", { lessonPlanId: PLAN_ID }],
          ["lesson.date >= :from", { from: "2026-03-01" }],
          ["lesson.date <= :to", { to: "2026-04-11" }],
        ]);
      });

      it("searches for every word, as the list does", async () => {
        await service.listCalendar(calendarQuery({ search: "senhas privacidade" }));

        const search = base.andWhere.mock.calls.find((call) =>
          String(call[0]).includes("lessonSearch0"),
        );
        expect(search?.[1]).toEqual({
          lessonSearch0: "%senhas%",
          lessonSearch1: "%privacidade%",
        });
      });

      it("orders by date, start time and id, ascending, as the list does", async () => {
        await service.listCalendar(calendarQuery());

        expect(base.orderBy).toHaveBeenCalledWith("lesson.date", "ASC");
        expect(base.addOrderBy.mock.calls).toEqual([
          ["lesson.startTime", "ASC"],
          ["lesson.id", "ASC"],
        ]);
      });
    });

    describe("the answer", () => {
      it("is a plain list of the items, each with the class of its lesson, the cancelled ones included", async () => {
        classes.listClassRefs.mockResolvedValue([
          buildClassRef({ id: CLASS_A_ID, creationRank: 1 }),
          buildClassRef({ id: CLASS_B_ID, code: "SEG-B", name: null, creationRank: 2 }),
        ]);
        state.lessons = [
          buildLesson({ id: "01999a3e-7c1b-7000-8000-0000000000f1", classId: CLASS_A_ID }),
          buildLesson({
            id: "01999a3e-7c1b-7000-8000-0000000000f2",
            classId: CLASS_B_ID,
            status: LessonStatus.CANCELLED,
            cancelledAt: new Date("2026-03-09T12:00:00.000Z"),
            cancelledById: ACTOR_ID,
          }),
        ];

        const items = await service.listCalendar(calendarQuery());

        expect(Array.isArray(items)).toBe(true);
        expect(
          items.map((item) => [item.id, item.class.code, item.class.colorIndex, item.status]),
        ).toEqual([
          ["01999a3e-7c1b-7000-8000-0000000000f1", "INFO-A", 0, LessonStatus.PLANNED],
          ["01999a3e-7c1b-7000-8000-0000000000f2", "SEG-B", 1, LessonStatus.CANCELLED],
        ]);
        expect(items[1].class.name).toBe("SEG-B");
      });

      it("is an empty list when the period has no lesson", async () => {
        state.lessons = [];

        await expect(service.listCalendar(calendarQuery())).resolves.toEqual([]);
      });

      it("throws, instead of guessing, when a lesson comes from a class that was not resolved", async () => {
        state.lessons = [buildLesson({ classId: CLASS_B_ID })];

        await expect(service.listCalendar(calendarQuery())).rejects.toThrow("was not resolved");
      });
    });

    describe("the staff of the period (GUS-158)", () => {
      it("asks the registry ONCE for the whole period, with the ids of every lesson of it", async () => {
        state.lessons = [
          buildLesson({ id: lessonId(1) }),
          buildLesson({ id: lessonId(2), date: "2026-03-17" }),
          buildLesson({ id: lessonId(3), date: "2026-04-02" }),
        ];

        await service.listCalendar(calendarQuery());

        expect(coverage.findConfirmedStaff).toHaveBeenCalledTimes(1);
        expect(coverage.findConfirmedStaff).toHaveBeenCalledWith([
          lessonId(1),
          lessonId(2),
          lessonId(3),
        ]);
      });

      it("costs one call for a busy month, not one per lesson", async () => {
        state.lessons = Array.from({ length: 250 }, (_, index) =>
          buildLesson({ id: lessonId(index + 1) }),
        );

        const items = await service.listCalendar(calendarQuery());

        expect(items).toHaveLength(250);
        expect(coverage.findConfirmedStaff).toHaveBeenCalledTimes(1);
        expect(coverage.findConfirmedStaff.mock.calls[0][0]).toHaveLength(250);
      });

      it("fills the teacher and belowExpectedMonitors of each item, the same rule as the list", async () => {
        state.lessons = [
          buildLesson({ id: lessonId(1), expectedMonitors: 2 }),
          buildLesson({ id: lessonId(2), expectedMonitors: 2 }),
          buildLesson({ id: lessonId(3), expectedMonitors: 2 }),
        ];
        coverage.findConfirmedStaff.mockResolvedValue(
          new Map<string, ConfirmedStaff>([
            [lessonId(1), { teachers: 1, monitors: 1, teacher: TEACHER }],
            [lessonId(2), { teachers: 0, monitors: 2, teacher: null }],
          ]),
        );

        const items = await service.listCalendar(calendarQuery());

        expect(items.map((item) => [item.teacher, item.belowExpectedMonitors])).toEqual([
          [TEACHER, true],
          [null, false],
          [null, true],
        ]);
      });

      it("does not ask the registry when no class matches, nor for a period with no lesson", async () => {
        classes.listClassRefs.mockResolvedValue([]);
        await service.listCalendar(calendarQuery());

        classes.listClassRefs.mockResolvedValue([buildClassRef()]);
        state.lessons = [];
        await service.listCalendar(calendarQuery());

        expect(coverage.findConfirmedStaff).not.toHaveBeenCalled();
      });

      it("does not ask the registry when the period is not valid", async () => {
        await httpFailure(
          service.listCalendar(calendarQuery({ from: "2026-04-11", to: "2026-03-01" })),
        );
        await httpFailure(
          service.listCalendar(calendarQuery({ from: "2026-03-01", to: "2026-04-12" })),
        );

        expect(coverage.findConfirmedStaff).not.toHaveBeenCalled();
      });

      it("fails the calendar when the registry fails", async () => {
        coverage.findConfirmedStaff.mockRejectedValue(new Error("boom"));

        await expect(service.listCalendar(calendarQuery())).rejects.toThrow("boom");
      });
    });
  });

  describe("findAgendaBetween() (GUS-160)", () => {
    it("asks the classes that are not archived and answers [] without querying lessons when there is none", async () => {
      classes.listClassRefs.mockResolvedValue([]);

      await expect(service.findAgendaBetween("2026-03-09", "2026-04-05")).resolves.toEqual([]);

      expect(classes.listClassRefs).toHaveBeenCalledTimes(1);
      expect(classes.listClassRefs).toHaveBeenCalledWith({ includeArchived: false });
      expect(dataSource.getRepository).not.toHaveBeenCalled();
      expect(base.getMany).not.toHaveBeenCalled();
    });

    it("filters the period with both ends, leaves out cancelled lessons and orders by date, start time and id", async () => {
      classes.listClassRefs.mockResolvedValue([
        buildClassRef(),
        buildClassRef({ id: CLASS_B_ID, code: "INFO-B", creationRank: 2 }),
      ]);

      await service.findAgendaBetween("2026-03-09", "2026-04-05");

      expect(dataSource.getRepository).toHaveBeenCalledWith(Lesson);
      expect(conditionsOf(base)).toEqual([
        ["lesson.classId IN (:...classIds)", { classIds: [CLASS_A_ID, CLASS_B_ID] }],
        ["lesson.date >= :from", { from: "2026-03-09" }],
        ["lesson.date <= :to", { to: "2026-04-05" }],
        ["lesson.status <> :cancelled", { cancelled: LessonStatus.CANCELLED }],
      ]);
      expect(base.orderBy).toHaveBeenCalledWith("lesson.date", "ASC");
      expect(base.addOrderBy.mock.calls).toEqual([
        ["lesson.startTime", "ASC"],
        ["lesson.id", "ASC"],
      ]);
      expect(base.getMany).toHaveBeenCalledTimes(1);
      // The agenda counts no staff: the caller does, through its own counter.
      expect(coverage.findConfirmedStaff).not.toHaveBeenCalled();
    });

    it("maps each lesson with its class, the name or the code as the label, the position and the place", async () => {
      classes.listClassRefs.mockResolvedValue([
        buildClassRef(),
        buildClassRef({ id: CLASS_B_ID, code: "INFO-B", name: null, creationRank: 2 }),
      ]);
      state.lessons = [
        buildLesson({
          id: lessonId(1),
          title: "Arquivos e pastas",
          sequenceOrder: 3,
          location: "Laboratório 2",
          expectedMonitors: 3,
          status: LessonStatus.CONFIRMED,
        }),
        buildLesson({ id: lessonId(2), classId: CLASS_B_ID, date: "2026-03-17" }),
      ];

      await expect(service.findAgendaBetween("2026-03-09", "2026-04-05")).resolves.toEqual([
        {
          id: lessonId(1),
          title: "Arquivos e pastas",
          sequenceOrder: 3,
          date: "2026-03-10",
          startTime: "14:00",
          endTime: "15:30",
          location: "Laboratório 2",
          status: LessonStatus.CONFIRMED,
          expectedMonitors: 3,
          class: { id: CLASS_A_ID, code: "INFO-A", name: "Informática Básica, turma A" },
        },
        {
          id: lessonId(2),
          title: "Senhas e privacidade",
          sequenceOrder: null,
          date: "2026-03-17",
          startTime: "14:00",
          endTime: "15:30",
          location: null,
          status: LessonStatus.PLANNED,
          expectedMonitors: null,
          class: { id: CLASS_B_ID, code: "INFO-B", name: "INFO-B" },
        },
      ]);
    });
  });

  describe("findAgendaByIds() (GUS-160)", () => {
    beforeEach(() => {
      repository.find.mockImplementation(async () => state.lessons);
    });

    it("answers [] without querying for no id, repeated or malformed ids only", async () => {
      await expect(service.findAgendaByIds([])).resolves.toEqual([]);
      await expect(service.findAgendaByIds(["not-a-uuid", "not-a-uuid", "42"])).resolves.toEqual(
        [],
      );

      expect(repository.find).not.toHaveBeenCalled();
      expect(classes.listClassRefs).not.toHaveBeenCalled();

      await service.findAgendaByIds([lessonId(1), lessonId(1), "not-a-uuid", lessonId(2)]);

      expect(repository.find).toHaveBeenCalledTimes(1);
      expect(repository.find).toHaveBeenCalledWith({
        where: { id: In([lessonId(1), lessonId(2)]) },
        order: { date: "ASC", startTime: "ASC", id: "ASC" },
      });
    });

    it("reads the lessons by id, any status, and the classes with the archived ones", async () => {
      const archivedClass = buildClassRef({
        id: CLASS_B_ID,
        code: "INFO-B",
        archivedAt: new Date("2026-03-01T12:00:00.000Z"),
        creationRank: 2,
      });
      classes.listClassRefs.mockResolvedValue([buildClassRef(), archivedClass]);
      state.lessons = [
        buildLesson({ id: lessonId(1), status: LessonStatus.CANCELLED }),
        buildLesson({ id: lessonId(2), classId: CLASS_B_ID, date: "2026-03-17" }),
      ];

      const agenda = await service.findAgendaByIds([lessonId(1), lessonId(2)]);

      expect(classes.listClassRefs).toHaveBeenCalledTimes(1);
      expect(classes.listClassRefs).toHaveBeenCalledWith({ includeArchived: true });
      // No filter by status: the cancelled lesson comes too, and the order is the one of the read.
      expect(repository.find.mock.calls[0][0]).not.toHaveProperty("where.status");
      expect(agenda.map((ref) => [ref.id, ref.status, ref.class.id])).toEqual([
        [lessonId(1), LessonStatus.CANCELLED, CLASS_A_ID],
        [lessonId(2), LessonStatus.PLANNED, CLASS_B_ID],
      ]);
      expect(coverage.findConfirmedStaff).not.toHaveBeenCalled();
    });

    it("does not read classes when no lesson comes back", async () => {
      state.lessons = [];

      await expect(service.findAgendaByIds([lessonId(1)])).resolves.toEqual([]);

      expect(repository.find).toHaveBeenCalledTimes(1);
      expect(classes.listClassRefs).not.toHaveBeenCalled();
    });

    it("throws when the class of a lesson is missing", async () => {
      state.lessons = [buildLesson({ id: lessonId(1), classId: CLASS_B_ID })];

      await expect(service.findAgendaByIds([lessonId(1)])).rejects.toThrow("was not resolved");
    });
  });
});
