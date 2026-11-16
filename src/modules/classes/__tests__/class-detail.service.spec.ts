import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { CourseLessonPlanItemResponseDto } from "@modules/catalog/dto/course-lesson-plan-item.response.dto";
import { CourseLessonPlansResponseDto } from "@modules/catalog/dto/course-lesson-plans.response.dto";
import { CourseLessonPlansService } from "@modules/catalog/services/course-lesson-plans.service";
import {
  CourseCategory,
  CoursesService,
  CourseStatus,
  CourseSummary,
} from "@modules/catalog/services/courses.service";
import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";
import { PeopleService } from "@modules/people/services/people.service";
import { ArchivableColumns } from "@shared/entities/archivable.columns";
import { CLASS_ENROLLMENTS_PREVIEW_LIMIT } from "../dto/class-limits";
import { SchoolClass } from "../entities/class.entity";
import { Edition } from "../entities/edition.entity";
import { ClassStatus } from "../enums/class-status.enum";
import { ClassDetailService } from "../services/class-detail.service";
import {
  ActiveEnrollmentPreviewRow,
  EnrollmentCountsService,
} from "../services/enrollment-counts.service";

const CREATED_AT = new Date("2026-09-01T12:00:00.000Z");
const ARCHIVED_AT = new Date("2026-10-10T12:00:00.000Z");

const CREATOR_ID = "01999a3e-0000-7000-8000-0000000000aa";
const COURSE_ID = "01999a3e-7c1b-7000-8000-000000000001";
const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const EDITION_ID = "01999a3e-7c1b-7000-8000-0000000000e1";
const STUDENT_A_ID = "01999a3e-7c1b-7000-8000-0000000000a1";
const STUDENT_B_ID = "01999a3e-7c1b-7000-8000-0000000000a2";
const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";

const CREATOR: PersonRefDto = { id: CREATOR_ID, name: "Carla Menezes" };
const STUDENT_A: PersonRefDto = { id: STUDENT_A_ID, name: "Ana Souza" };
const STUDENT_B: PersonRefDto = { id: STUDENT_B_ID, name: "Bruno Lima" };

type ClassOverrides = Partial<Omit<SchoolClass, "archive">> & {
  archive?: Partial<ArchivableColumns>;
};

function buildClass(overrides: ClassOverrides = {}): SchoolClass {
  const { archive, ...rest } = overrides;
  return Object.assign(new SchoolClass(), {
    id: CLASS_ID,
    code: "INFO-A",
    name: null,
    courseId: COURSE_ID,
    editionId: EDITION_ID,
    startDate: "2026-03-03",
    endDate: "2026-06-27",
    location: null,
    capacity: 15,
    status: ClassStatus.PLANNED,
    createdById: CREATOR_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    archive: Object.assign(new ArchivableColumns(), {
      archivedAt: null,
      archivedById: null,
      archiveReason: null,
      ...archive,
    }),
    ...rest,
  });
}

function buildEdition(): Edition {
  return Object.assign(new Edition(), {
    id: EDITION_ID,
    name: "2026.1",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
  });
}

function buildCourse(overrides: Partial<CourseSummary> = {}): CourseSummary {
  return {
    id: COURSE_ID,
    name: "Informática Básica",
    category: CourseCategory.BASIC,
    status: CourseStatus.ACTIVE,
    ...overrides,
  };
}

function buildItem(
  position: number,
  expectedDurationMinutes: number,
  archivedAt: Date | null = null,
): CourseLessonPlanItemResponseDto {
  return {
    position,
    lessonPlanId: `01999a3e-7c1b-7000-8000-0000000000${String(position).padStart(2, "0")}`,
    title: `Plano ${position}`,
    contents: [`Conteúdo ${position}`],
    expectedDurationMinutes,
    materialUrl: null,
    courseCount: 1,
    archivedAt,
  };
}

/** `count` plans of `minutes` each: the 6 plans of 90 minutes of the course of the card. */
function buildSequence(
  items: CourseLessonPlanItemResponseDto[] = Array.from({ length: 6 }, (_, index) =>
    buildItem(index + 1, 90),
  ),
): CourseLessonPlansResponseDto {
  return {
    courseId: COURSE_ID,
    plannedWorkloadMinutes: items.reduce((sum, item) => sum + item.expectedDurationMinutes, 0),
    items,
  };
}

function buildRow(
  enrollmentId: string,
  studentId: string,
  enrolledAt: string,
): ActiveEnrollmentPreviewRow {
  return { enrollmentId, studentId, enrolledAt: new Date(enrolledAt) };
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

describe("ClassDetailService", () => {
  let service: ClassDetailService;
  let state: {
    schoolClass: SchoolClass | null;
    edition: Edition;
    course: CourseSummary | null;
    sequence: CourseLessonPlansResponseDto;
    enrolledCount: number;
    previewRows: ActiveEnrollmentPreviewRow[];
    people: PersonRefDto[];
  };

  const manager = { findOne: jest.fn(), findOneOrFail: jest.fn() };
  const dataSource = { manager, transaction: jest.fn() };
  const courses = { getCourseSummary: jest.fn() };
  const courseLessonPlans = { readSequence: jest.fn() };
  const people = { findRefsByIds: jest.fn() };
  const enrollmentCounts = { countActive: jest.fn(), listActivePreview: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    state = {
      schoolClass: buildClass(),
      edition: buildEdition(),
      course: buildCourse(),
      sequence: buildSequence(),
      enrolledCount: 12,
      previewRows: [
        buildRow("01999a3e-7c1b-7000-8000-0000000000f1", STUDENT_A_ID, "2026-02-18T10:00:00.000Z"),
        buildRow("01999a3e-7c1b-7000-8000-0000000000f2", STUDENT_B_ID, "2026-02-19T10:00:00.000Z"),
      ],
      people: [CREATOR, STUDENT_A, STUDENT_B],
    };

    manager.findOne.mockImplementation(async () => state.schoolClass);
    manager.findOneOrFail.mockImplementation(async () => state.edition);
    courses.getCourseSummary.mockImplementation(async () => state.course);
    courseLessonPlans.readSequence.mockImplementation(async () => state.sequence);
    enrollmentCounts.countActive.mockImplementation(async () => state.enrolledCount);
    enrollmentCounts.listActivePreview.mockImplementation(async () => state.previewRows);
    // As the real one: only the people that exist come back, in no particular order.
    people.findRefsByIds.mockImplementation(async (ids: readonly string[]) =>
      state.people.filter((person) => ids.includes(person.id)),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        ClassDetailService,
        { provide: DataSource, useValue: dataSource },
        { provide: CoursesService, useValue: courses },
        { provide: CourseLessonPlansService, useValue: courseLessonPlans },
        { provide: PeopleService, useValue: people },
        { provide: EnrollmentCountsService, useValue: enrollmentCounts },
      ],
    }).compile();

    service = moduleRef.get(ClassDetailService);
  });

  describe("findDetail()", () => {
    it("assembles data, course, summary and preview in one call", async () => {
      const detail = await service.findDetail(CLASS_ID);

      expect(detail).toEqual({
        id: CLASS_ID,
        code: "INFO-A",
        name: null,
        edition: { id: EDITION_ID, name: "2026.1" },
        startDate: "2026-03-03",
        endDate: "2026-06-27",
        location: null,
        capacity: 15,
        status: "planned",
        archivedAt: null,
        createdAt: CREATED_AT,
        createdBy: { id: CREATOR_ID, name: "Carla Menezes" },
        course: {
          id: COURSE_ID,
          name: "Informática Básica",
          category: "basic",
          status: "active",
          lessonPlanCount: 6,
          plannedWorkloadMinutes: 540,
        },
        summary: {
          enrolledCount: 12,
          capacity: 15,
          occupancyRate: 0.8,
          lessonsDone: null,
          lessonsTotal: null,
          averageAttendance: null,
        },
        enrollmentsPreview: [
          {
            id: "01999a3e-7c1b-7000-8000-0000000000f1",
            student: { id: STUDENT_A_ID, name: "Ana Souza" },
            enrolledAt: new Date("2026-02-18T10:00:00.000Z"),
          },
          {
            id: "01999a3e-7c1b-7000-8000-0000000000f2",
            student: { id: STUDENT_B_ID, name: "Bruno Lima" },
            enrolledAt: new Date("2026-02-19T10:00:00.000Z"),
          },
        ],
        enrollmentsTotal: 12,
      });
    });

    it("throws CLASS_NOT_FOUND for an unknown id, and reads nothing else", async () => {
      state.schoolClass = null;

      const failure = await httpFailure(service.findDetail(UNKNOWN_ID));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "CLASS_NOT_FOUND",
        message: "Class not found.",
      });
      expect(manager.findOne).toHaveBeenCalledTimes(1);
      expect(manager.findOneOrFail).not.toHaveBeenCalled();
      expect(courses.getCourseSummary).not.toHaveBeenCalled();
      expect(courseLessonPlans.readSequence).not.toHaveBeenCalled();
      expect(enrollmentCounts.countActive).not.toHaveBeenCalled();
      expect(enrollmentCounts.listActivePreview).not.toHaveBeenCalled();
      expect(people.findRefsByIds).not.toHaveBeenCalled();
    });

    it("reads an archived class, with archivedAt set and its status kept", async () => {
      state.schoolClass = buildClass({
        status: ClassStatus.COMPLETED,
        archive: { archivedAt: ARCHIVED_AT, archivedById: CREATOR_ID, archiveReason: "Fim." },
      });

      const detail = await service.findDetail(CLASS_ID);

      // The lookup has no filter on the archive: only the id.
      expect(manager.findOne).toHaveBeenCalledWith(SchoolClass, { where: { id: CLASS_ID } });
      expect(detail.archivedAt).toEqual(ARCHIVED_AT);
      expect(detail.status).toBe("completed");
      expect(detail.id).toBe(CLASS_ID);
    });

    it("uses the id stored in the database, not the requested one, after the lookup", async () => {
      const requestedId = CLASS_ID.toUpperCase();

      const detail = await service.findDetail(requestedId);

      // The requested id is only the key of the lookup...
      expect(manager.findOne).toHaveBeenCalledWith(SchoolClass, { where: { id: requestedId } });
      // ...and everything after it uses the id the row has.
      expect(enrollmentCounts.countActive).toHaveBeenCalledWith(manager, CLASS_ID);
      expect(enrollmentCounts.listActivePreview).toHaveBeenCalledWith(
        manager,
        CLASS_ID,
        CLASS_ENROLLMENTS_PREVIEW_LIMIT,
      );
      expect(detail.id).toBe(CLASS_ID);
    });

    it("asks the preview with limit 5", async () => {
      await service.findDetail(CLASS_ID);

      expect(CLASS_ENROLLMENTS_PREVIEW_LIMIT).toBe(5);
      expect(enrollmentCounts.listActivePreview).toHaveBeenCalledTimes(1);
      expect(enrollmentCounts.listActivePreview).toHaveBeenCalledWith(manager, CLASS_ID, 5);
      expect(enrollmentCounts.countActive).toHaveBeenCalledTimes(1);
      expect(enrollmentCounts.countActive).toHaveBeenCalledWith(manager, CLASS_ID);
    });

    it("reads the edition, even a deleted one, and the course and its sequence by the ids of the class", async () => {
      await service.findDetail(CLASS_ID);

      expect(manager.findOneOrFail).toHaveBeenCalledTimes(1);
      expect(manager.findOneOrFail).toHaveBeenCalledWith(Edition, {
        where: { id: EDITION_ID },
        withDeleted: true,
      });
      // No `forShare`: the course is only read here.
      expect(courses.getCourseSummary).toHaveBeenCalledTimes(1);
      expect(courses.getCourseSummary).toHaveBeenCalledWith(COURSE_ID, manager);
      expect(courseLessonPlans.readSequence).toHaveBeenCalledTimes(1);
      expect(courseLessonPlans.readSequence).toHaveBeenCalledWith(manager, COURSE_ID);
    });

    it("resolves the creator and the students in a single findRefsByIds call", async () => {
      await service.findDetail(CLASS_ID);

      expect(people.findRefsByIds).toHaveBeenCalledTimes(1);
      expect(people.findRefsByIds).toHaveBeenCalledWith([CREATOR_ID, STUDENT_A_ID, STUDENT_B_ID]);
    });

    it("still asks for the creator when the preview is empty", async () => {
      state.previewRows = [];

      const detail = await service.findDetail(CLASS_ID);

      expect(people.findRefsByIds).toHaveBeenCalledTimes(1);
      expect(people.findRefsByIds).toHaveBeenCalledWith([CREATOR_ID]);
      expect(detail.createdBy).toEqual(CREATOR);
    });

    it("answers createdBy null when the person is gone, and the rest of the sheet intact", async () => {
      state.people = [STUDENT_A, STUDENT_B];

      const detail = await service.findDetail(CLASS_ID);

      expect(detail.createdBy).toBeNull();
      expect(detail.id).toBe(CLASS_ID);
      expect(detail.enrollmentsPreview).toHaveLength(2);
    });

    it("leaves a student that cannot be found out of the preview, and keeps the total", async () => {
      state.people = [CREATOR, STUDENT_B];

      const detail = await service.findDetail(CLASS_ID);

      expect(detail.enrollmentsPreview.map((item) => item.student)).toEqual([STUDENT_B]);
      expect(detail.enrollmentsTotal).toBe(12);
    });

    it("takes the number of plans and the workload from the sequence, archived plans included", async () => {
      state.sequence = buildSequence([
        buildItem(1, 60),
        buildItem(2, 90, ARCHIVED_AT),
        buildItem(3, 120),
      ]);

      const detail = await service.findDetail(CLASS_ID);

      expect(detail.course.lessonPlanCount).toBe(3);
      expect(detail.course.plannedWorkloadMinutes).toBe(270);
    });

    it("answers the current category of the course, whatever the course was when the class was made", async () => {
      state.course = buildCourse({ category: CourseCategory.INTERMEDIATE });

      const detail = await service.findDetail(CLASS_ID);

      expect(detail.course.category).toBe("intermediate");
    });

    it("answers an empty preview and zero for a class without enrollments", async () => {
      state.enrolledCount = 0;
      state.previewRows = [];

      const detail = await service.findDetail(CLASS_ID);

      expect(detail.enrollmentsPreview).toEqual([]);
      expect(detail.enrollmentsTotal).toBe(0);
      expect(detail.summary).toEqual({
        enrolledCount: 0,
        capacity: 15,
        occupancyRate: 0,
        lessonsDone: null,
        lessonsTotal: null,
        averageAttendance: null,
      });
    });

    it("keeps lessonsDone, lessonsTotal and averageAttendance as null, and asks nobody for them", async () => {
      const detail = await service.findDetail(CLASS_ID);

      expect(detail.summary).toHaveProperty("lessonsDone", null);
      expect(detail.summary).toHaveProperty("lessonsTotal", null);
      expect(detail.summary).toHaveProperty("averageAttendance", null);
    });

    it("reads without a transaction and without a lock", async () => {
      await service.findDetail(CLASS_ID);

      expect(dataSource.transaction).not.toHaveBeenCalled();
      const options = manager.findOne.mock.calls[0][1] as Record<string, unknown>;
      expect(options).not.toHaveProperty("lock");
    });

    it("throws when the course of the class cannot be read, a broken invariant and not a business error", async () => {
      state.course = null;

      const failure = await service.findDetail(CLASS_ID).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(HttpException);
      expect((failure as Error).message).toBe(
        `The course ${COURSE_ID} of a class could not be read.`,
      );
      expect(people.findRefsByIds).not.toHaveBeenCalled();
    });

    it("keeps any error of the reads as it came", async () => {
      const failure = new Error("connection lost");
      courseLessonPlans.readSequence.mockRejectedValueOnce(failure);

      await expect(service.findDetail(CLASS_ID)).rejects.toBe(failure);
    });
  });
});
