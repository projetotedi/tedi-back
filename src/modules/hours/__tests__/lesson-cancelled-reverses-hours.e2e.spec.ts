import "reflect-metadata";
import { EventEmitter2, EventEmitterModule } from "@nestjs/event-emitter";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { config } from "dotenv";
import { join } from "node:path";
import { DataSource } from "typeorm";
import { CatalogModule } from "@modules/catalog/catalog.module";
import { CourseCategory, CoursesService } from "@modules/catalog/services/courses.service";
import { ClassesModule } from "@modules/classes/classes.module";
import { ClassesService } from "@modules/classes/services/classes.service";
import { LessonsModule } from "@modules/lessons/lessons.module";
import { LessonsService, LessonSummary } from "@modules/lessons/services/lessons.service";
import { PeopleModule } from "@modules/people/people.module";
import { PeopleService } from "@modules/people/services/people.service";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import {
  LESSON_CANCELLED_EVENT,
  LessonCancelledEvent,
} from "@shared/events/lesson-cancelled.event";
import { HourEntry } from "../entities/hour-entry.entity";
import { HourEntryCategory } from "../enums/hour-entry-category.enum";
import { HourEntryOrigin } from "../enums/hour-entry-origin.enum";
import { HoursModule } from "../hours.module";
import { LessonCancelledListener } from "../listeners/lesson-cancelled.listener";
import { LessonHoursService } from "../services/lesson-hours.service";
import { entryRow, eventsOf, reviewEntry } from "./fixtures/hour-entries.fixture";

config();

const dbUrl = process.env.DATABASE_URL;
const dbConnection = dbUrl
  ? { url: dbUrl }
  : {
      host: process.env.DB_HOST ?? "localhost",
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USERNAME ?? "tedi",
      password: process.env.DB_PASSWORD ?? "tedi",
      database: process.env.DB_DATABASE ?? "tedi",
    };

/** Every entity: the foreign keys of HourEntry point to other modules by table name. */
const ALL_ENTITIES = [join(__dirname, "..", "..", "..", "**", "*.entity.{ts,js}")];

interface Scenery {
  coordinatorId: string;
  teacherId: string;
  monitorId: string;
  lesson: LessonSummary;
  otherLesson: LessonSummary;
}

/**
 * The flow between modules (docs/ARCHITECTURE.md section 5), in the module that reacts: `lessons`
 * emits `lesson.cancelled` and `hours` reverses the attendance hours of the lesson (RN-07, GUS-168).
 * The event is emitted with `emitAsync`, which waits for the listener, so the test is deterministic;
 * `LessonsService.cancel` emits without waiting and is not used here.
 */
describe("lesson.cancelled reverses the attendance hours (e2e)", () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let eventEmitter: EventEmitter2;
  let lessonHours: LessonHoursService;
  let peopleService: PeopleService;
  let coursesService: CoursesService;
  let classesService: ClassesService;
  let lessonsService: LessonsService;
  let audits: AuditableActionEvent[];

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        EventEmitterModule.forRoot(),
        TypeOrmModule.forRoot({
          type: "postgres",
          ...dbConnection,
          ssl: dbUrl ? { rejectUnauthorized: false } : false,
          entities: ALL_ENTITIES,
          synchronize: false,
          migrationsRun: false,
        }),
        PeopleModule,
        CatalogModule,
        ClassesModule,
        LessonsModule,
        HoursModule,
      ],
    }).compile();
    // The @OnEvent listeners are only subscribed in onApplicationBootstrap: without init, nobody
    // hears the event and every test fails.
    await module.init();

    dataSource = module.get(DataSource);
    eventEmitter = module.get(EventEmitter2);
    lessonHours = module.get(LessonHoursService);
    peopleService = module.get(PeopleService);
    coursesService = module.get(CoursesService);
    classesService = module.get(ClassesService);
    lessonsService = module.get(LessonsService);
    eventEmitter.on(AUDITABLE_ACTION_EVENT, (event: AuditableActionEvent) => audits.push(event));
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    audits = [];
    await dataSource.query(
      `TRUNCATE TABLE hour_entry_events, hour_entries, lessons, classes, editions,
                      course_lesson_plans, lesson_plan_contents, lesson_plans,
                      course_prerequisites, courses, people
       RESTART IDENTITY CASCADE`,
    );
  });

  /** The people, a class and two lessons of 90 minutes, through the services of the other modules. */
  async function setUp(): Promise<Scenery> {
    const coordinator = await peopleService.save({ name: "Coordinator" });
    const teacher = await peopleService.save({ name: "Teacher" });
    const monitor = await peopleService.save({ name: "Monitor" });
    const course = await coursesService.create(
      {
        name: "Informática Básica",
        description: "Fundamentos do uso do computador.",
        category: CourseCategory.BASIC,
      },
      coordinator.id,
    );
    const schoolClass = await classesService.create(
      {
        courseId: course.id,
        code: "INFO-A",
        editionName: "2026.1",
        startDate: "2026-03-03",
        endDate: "2026-06-27",
        capacity: 15,
      },
      coordinator.id,
    );
    const lessonOn = async (date: string): Promise<LessonSummary> => {
      const created = await lessonsService.create(
        {
          classId: schoolClass.id,
          title: "Teclado, mouse e janelas",
          date,
          startTime: "14:00",
          endTime: "15:30",
        },
        coordinator.id,
      );
      const summary = await lessonsService.getLessonSummary(created.id);
      if (summary === null) throw new Error("The lesson that was just created is gone.");
      return summary;
    };

    return {
      coordinatorId: coordinator.id,
      teacherId: teacher.id,
      monitorId: monitor.id,
      lesson: await lessonOn("2026-03-10"),
      otherLesson: await lessonOn("2026-03-17"),
    };
  }

  /** The lesson hours of a presence, as the attendance writes them: one transaction. */
  async function recordPresence(
    personId: string,
    confirmedById: string,
    lesson: LessonSummary,
  ): Promise<string> {
    const recorded = await dataSource.transaction((manager) =>
      lessonHours.recordPresence(manager, { personId, confirmedById, lesson }, new Date()),
    );
    return recorded.hourEntryId;
  }

  function cancel(scenery: Scenery): Promise<unknown> {
    return eventEmitter.emitAsync(
      LESSON_CANCELLED_EVENT,
      new LessonCancelledEvent({
        lessonId: scenery.lesson.id,
        classId: scenery.lesson.classId,
        date: scenery.lesson.date,
        cancelledById: scenery.coordinatorId,
        cancelledAt: new Date(),
      }),
    );
  }

  function reversals(): AuditableActionEvent[] {
    return audits.filter((event) => event.action === AuditableAction.HOUR_ENTRY_REVERSED);
  }

  it("reverses every attendance entry of the cancelled lesson, approved or adjusted, with a reversed row in the history and HOUR_ENTRY_REVERSED, and leaves the other lesson and the manual entries without a lesson alone", async () => {
    const scenery = await setUp();
    const monitorEntry = await recordPresence(scenery.monitorId, scenery.teacherId, scenery.lesson);
    const teacherEntry = await recordPresence(
      scenery.teacherId,
      scenery.coordinatorId,
      scenery.lesson,
    );
    await reviewEntry(dataSource, teacherEntry, {
      status: "adjusted",
      validatedMinutes: 60,
      reviewNote: "A aula terminou mais cedo.",
      reviewedById: scenery.coordinatorId,
    });
    const otherLessonEntry = await recordPresence(
      scenery.monitorId,
      scenery.teacherId,
      scenery.otherLesson,
    );
    const repository = dataSource.getRepository(HourEntry);
    const manualEntry = await repository.save(
      repository.create({
        personId: scenery.monitorId,
        createdById: scenery.monitorId,
        origin: HourEntryOrigin.MANUAL,
        activity: "Planejamento da aula",
        category: HourEntryCategory.PLANNING,
        date: "2026-03-10",
        declaredMinutes: 60,
      }),
    );
    audits = [];

    await cancel(scenery);

    const reversed: Array<[string, string, number]> = [
      [monitorEntry, "approved", 90],
      [teacherEntry, "adjusted", 60],
    ];
    for (const [id, fromStatus, fromMinutes] of reversed) {
      const row = await entryRow(dataSource, id);
      expect(row?.deleted_at).toBeInstanceOf(Date);
      expect(row?.updated_at).toEqual(row?.deleted_at);
      const history = await eventsOf(dataSource, id);
      expect(history.at(-1)).toMatchObject({
        type: "reversed",
        actor_id: scenery.coordinatorId,
        from_status: fromStatus,
        to_status: null,
        from_minutes: fromMinutes,
        to_minutes: null,
        note: null,
      });
      expect(history.at(-1)?.created_at).toEqual(row?.deleted_at);
    }
    expect((await entryRow(dataSource, otherLessonEntry))?.deleted_at).toBeNull();
    expect((await entryRow(dataSource, manualEntry.id))?.deleted_at).toBeNull();
    expect((await eventsOf(dataSource, otherLessonEntry)).map((event) => event.type)).toEqual([
      "created",
      "approved",
    ]);

    expect(
      reversals()
        .map((event) => event.targetId)
        .sort(),
    ).toEqual([monitorEntry, teacherEntry].sort());
    expect(reversals()[0]).toMatchObject({
      actorId: scenery.coordinatorId,
      targetType: "hour_entry",
    });
    expect(JSON.stringify(reversals())).not.toContain("Teclado");
  });

  it("reverses the manual and on-behalf entries linked to the cancelled lesson, and leaves the ones linked to another lesson or only to the class (GUS-172)", async () => {
    const scenery = await setUp();
    const repository = dataSource.getRepository(HourEntry);
    const log = async (
      link: { classId: string; lessonId: string | null },
      createdById = scenery.monitorId,
    ): Promise<string> => {
      const entry = await repository.save(
        repository.create({
          personId: scenery.monitorId,
          createdById,
          origin:
            createdById === scenery.monitorId ? HourEntryOrigin.MANUAL : HourEntryOrigin.ON_BEHALF,
          activity: "Planejamento da aula",
          category: HourEntryCategory.PLANNING,
          date: "2026-03-10",
          declaredMinutes: 60,
          ...link,
        }),
      );
      return entry.id;
    };
    const { lesson, otherLesson } = scenery;
    const manual = await log({ classId: lesson.classId, lessonId: lesson.id });
    const onBehalf = await log(
      { classId: lesson.classId, lessonId: lesson.id },
      scenery.coordinatorId,
    );
    const ofOtherLesson = await log({ classId: otherLesson.classId, lessonId: otherLesson.id });
    const onlyClass = await log({ classId: lesson.classId, lessonId: null });
    audits = [];

    await cancel(scenery);

    for (const id of [manual, onBehalf]) {
      expect((await entryRow(dataSource, id))?.deleted_at).toBeInstanceOf(Date);
      expect((await eventsOf(dataSource, id)).at(-1)).toMatchObject({
        type: "reversed",
        actor_id: scenery.coordinatorId,
        from_status: "pending",
        from_minutes: 60,
      });
    }
    for (const id of [ofOtherLesson, onlyClass]) {
      expect((await entryRow(dataSource, id))?.deleted_at).toBeNull();
    }
    expect(
      reversals()
        .map((event) => event.targetId)
        .sort(),
    ).toEqual([manual, onBehalf].sort());
  });

  it("does nothing the second time the same lesson.cancelled arrives: no row and no event", async () => {
    const scenery = await setUp();
    const entry = await recordPresence(scenery.monitorId, scenery.teacherId, scenery.lesson);
    await cancel(scenery);
    const historyAfterFirst = await eventsOf(dataSource, entry);
    audits = [];

    await cancel(scenery);

    expect(await eventsOf(dataSource, entry)).toEqual(historyAfterFirst);
    expect(historyAfterFirst.map((event) => event.type)).toEqual([
      "created",
      "approved",
      "reversed",
    ]);
    expect(audits).toEqual([]);
  });

  it("leaves an entry already reversed by a correction as it is", async () => {
    const scenery = await setUp();
    const corrected = await recordPresence(scenery.monitorId, scenery.teacherId, scenery.lesson);
    const active = await recordPresence(scenery.teacherId, scenery.coordinatorId, scenery.lesson);
    await dataSource.transaction((manager) =>
      lessonHours.reverseEntries(manager, [corrected], scenery.coordinatorId, new Date()),
    );
    const correctedHistory = await eventsOf(dataSource, corrected);
    audits = [];

    await cancel(scenery);

    expect(await eventsOf(dataSource, corrected)).toEqual(correctedHistory);
    expect(correctedHistory.filter((event) => event.type === "reversed")).toHaveLength(1);
    expect((await eventsOf(dataSource, active)).at(-1)?.type).toBe("reversed");
    expect(reversals().map((event) => event.targetId)).toEqual([active]);
  });

  it("cancelling the lesson again repairs a reversal that never happened, and cancelling it once more changes nothing", async () => {
    const scenery = await setUp();
    const entry = await recordPresence(scenery.monitorId, scenery.teacherId, scenery.lesson);
    // The lesson was cancelled, but its listener never ran (the process fell after the commit).
    const cancelledAt = new Date("2026-03-11T12:00:00.000Z");
    await dataSource.query(
      `UPDATE lessons
          SET status = 'cancelled', cancel_reason = 'Feriado municipal.', cancelled_at = $2,
              cancelled_by_id = $3, updated_at = $2
        WHERE id = $1`,
      [scenery.lesson.id, cancelledAt, scenery.coordinatorId],
    );
    expect((await entryRow(dataSource, entry))?.deleted_at).toBeNull();
    // `LessonsService.cancel` emits without waiting: the spy hands over the promise of the listener.
    const listener = jest.spyOn(module.get(LessonCancelledListener), "reverseLessonHours");
    audits = [];

    try {
      await lessonsService.cancel(scenery.lesson.id, { reason: "De novo." }, scenery.coordinatorId);
      expect(listener).toHaveBeenCalledTimes(1);
      await listener.mock.results[0].value;

      expect((await entryRow(dataSource, entry))?.deleted_at).toBeInstanceOf(Date);
      const repaired = await eventsOf(dataSource, entry);
      expect(repaired.map((event) => event.type)).toEqual(["created", "approved", "reversed"]);
      expect(repaired.at(-1)?.actor_id).toBe(scenery.coordinatorId);
      expect(reversals().map((event) => event.targetId)).toEqual([entry]);

      await lessonsService.cancel(scenery.lesson.id, { reason: "Outra vez." }, scenery.teacherId);
      expect(listener).toHaveBeenCalledTimes(2);
      await listener.mock.results[1].value;

      expect(await eventsOf(dataSource, entry)).toEqual(repaired);
      expect(reversals()).toHaveLength(1);
    } finally {
      listener.mockRestore();
    }
  });
});
