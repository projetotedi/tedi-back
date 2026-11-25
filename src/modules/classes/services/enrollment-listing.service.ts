import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { CoursesService, CourseSummary } from "@modules/catalog/services/courses.service";
import {
  StudentListEntry,
  StudentsService,
  studentNotFound,
} from "@modules/people/services/students.service";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { normalizePagination, PaginatedResult } from "@shared/pagination/pagination.util";
import { Permission } from "@shared/permissions/permission.enum";
import { PermissionPolicy } from "@shared/permissions/permission.policy";
import { AvailableStudentItemResponseDto } from "../dto/available-student-item.response.dto";
import { ClassEnrollmentItemResponseDto } from "../dto/class-enrollment-item.response.dto";
import { EnrollmentClassRefResponseDto } from "../dto/enrollment-class-ref.response.dto";
import { ListAvailableStudentsQueryDto } from "../dto/list-available-students-query.dto";
import { ListClassEnrollmentsQueryDto } from "../dto/list-class-enrollments-query.dto";
import { ListStudentsByEnrollmentQueryDto } from "../dto/list-students-by-enrollment-query.dto";
import { StudentByEnrollmentItemResponseDto } from "../dto/student-by-enrollment-item.response.dto";
import { StudentEnrollmentsResponseDto } from "../dto/student-enrollments.response.dto";
import { SchoolClass } from "../entities/class.entity";
import { EnrollmentStatus } from "../enums/enrollment-status.enum";
import { StudentEnrollmentSituation } from "../enums/student-enrollment-situation.enum";
import { classNotFound } from "./classes.service";
import { EnrollmentAttendanceRegistry } from "./enrollment-attendance.registry";
import {
  ClassEnrollmentRow,
  EnrollmentClassRow,
  StudentEnrollmentRow,
  summarizeStudentEnrollments,
  toClassEnrollmentItem,
  toEnrollmentClassRef,
  toStudentEnrollmentItem,
} from "./enrollment-response.mapper";

/** One active enrollment of a student with its class, for `currentClasses`. */
interface CurrentClassRow extends EnrollmentClassRow {
  studentId: string;
}

/**
 * The reads of the enrollments (GUS-108, docs/ARCHITECTURE.md section 19): the list of a class, the
 * students that can be enrolled in it, the history of a student and the students by enrollment.
 * Read-only: no transaction, no lock, no event and no log (RNF-13). Never the reason of a change.
 *
 * `classes` never reads the tables of `people`: the students are paged, ordered, searched and aged
 * by `StudentsService.listStudentEntries`, with the ids this module finds in its enrollments. The page
 * is then completed with the data of this module in ONE query per page (never one per student).
 * Every `date` column read raw comes out `::text`, so it stays "YYYY-MM-DD" (the driver would make
 * it a Date at midnight of the server, which can be the day before).
 *
 * The `attendanceRate` of the list of a class and of the history of a student comes from the
 * attendance (GUS-166), through the port `EnrollmentAttendanceRegistry`: ONE call per page or per
 * history, with the ids of its enrollments, and none for an empty one.
 */
@Injectable()
export class EnrollmentListingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly students: StudentsService,
    private readonly courses: CoursesService,
    private readonly policy: PermissionPolicy,
    private readonly attendance: EnrollmentAttendanceRegistry,
  ) {}

  /**
   * The enrollments of a class, every status unless `status` is asked, by the name of the student
   * and then the person id (the order of a roll call), paginated and searchable by name. An archived
   * class answers 200, and an archived student with an old enrollment stays in it (history).
   *
   * `phone` and `accessibilityNeed` of the students go out only when the actor can see students
   * (students.view), asked once per request; null otherwise (section 19, M11). `attendanceRate` is
   * the one of the enrollment (section 18.1, S14), null while it has no roll call recorded.
   * `total` with `status=active` and no search is the `enrollmentsTotal` of the sheet of the class.
   */
  async listClassEnrollments(
    classId: string,
    query: ListClassEnrollmentsQueryDto,
    actor: AuthUser,
  ): Promise<PaginatedResult<ClassEnrollmentItemResponseDto>> {
    const schoolClass = await this.findClass(classId);
    const { page, limit } = normalizePagination(query);

    const rows: ClassEnrollmentRow[] = await this.dataSource.query(
      `SELECT id AS "id", student_id AS "studentId", status AS "status",
              enrolled_at AS "enrolledAt", status_changed_at::text AS "statusChangedAt"
         FROM enrollments
        WHERE class_id = $1 AND deleted_at IS NULL
          AND ($2::enrollments_status_enum IS NULL OR status = $2::enrollments_status_enum)`,
      [schoolClass.id, query.status ?? null],
    );
    if (rows.length === 0) return { data: [], total: 0, page, limit };

    const byStudent = new Map(rows.map((row) => [row.studentId, row]));
    const students = await this.students.listStudentEntries(
      { onlyIds: [...byStudent.keys()], search: query.search, includeArchived: true },
      { page, limit },
    );
    const canSeeStudentContact = this.policy.can(actor, Permission.STUDENTS_VIEW);
    const entries = students.data.map((student) => ({
      student,
      row: this.rowOf(byStudent, student),
    }));
    const rates = await this.attendanceRatesOf(entries.map(({ row }) => row.id));

    return {
      data: entries.map(({ student, row }) =>
        toClassEnrollmentItem(row, student, {
          canSeeStudentContact,
          attendanceRate: rates.get(row.id) ?? null,
        }),
      ),
      total: students.total,
      page: students.page,
      limit: students.limit,
    };
  }

  /**
   * The students that can be enrolled in the class: not archived and without an enrollment in it
   * that is not removed, in ANY status (section 19, M7: the list shows exactly whom the POST
   * enrolls; a dropped student comes back through the change of status). By name, paginated and
   * searchable, each with the other classes where she is active (`currentClasses`).
   */
  async listAvailableStudents(
    classId: string,
    query: ListAvailableStudentsQueryDto,
  ): Promise<PaginatedResult<AvailableStudentItemResponseDto>> {
    const schoolClass = await this.findClass(classId);
    const { page, limit } = normalizePagination(query);

    const enrolled: Array<{ studentId: string }> = await this.dataSource.query(
      `SELECT student_id AS "studentId" FROM enrollments WHERE class_id = $1 AND deleted_at IS NULL`,
      [schoolClass.id],
    );
    const students = await this.students.listStudentEntries(
      {
        excludeIds: enrolled.map((row) => row.studentId),
        search: query.search,
        includeArchived: false,
      },
      { page, limit },
    );
    const currentClasses = await this.findCurrentClasses(
      students.data.map((student) => student.id),
    );

    return {
      data: students.data.map((student) => ({
        id: student.id,
        name: student.name,
        age: student.age,
        currentClasses: currentClasses.get(student.id) ?? [],
      })),
      total: students.total,
      page: students.page,
      limit: students.limit,
    };
  }

  /**
   * The enrollment history of a student (RF-031): every enrollment that is not removed, archived
   * classes included (a removed class is left out, the rule of `currentClasses`), the newest first (`enrolledAt`, then id), each with its class and the course
   * of the class (read in one call to the catalog), and the summary derived from them (RN-16: the
   * completed courses come from the completed enrollments, no table of their own). Not paginated:
   * a student has tens of enrollments.
   *
   * 404 STUDENT_NOT_FOUND for an id that is not a student (no profile, removed, malformed); an
   * archived student answers 200.
   */
  async listStudentEnrollments(studentId: string): Promise<StudentEnrollmentsResponseDto> {
    const [student] = await this.students.findStudentSummaries([studentId]);
    if (student === undefined) throw studentNotFound();

    // A removed class (soft delete) leaves the history, as it leaves `currentClasses`: one rule for
    // both reads. No route removes a class today; an archived class stays in both.
    const rows: StudentEnrollmentRow[] = await this.dataSource.query(
      `SELECT e.id AS "id", e.status AS "status", e.enrolled_at AS "enrolledAt",
              e.status_changed_at::text AS "statusChangedAt", c.course_id AS "courseId",
              c.id AS "classId", c.code AS "classCode", c.name AS "className",
              ed.id AS "editionId", ed.name AS "editionName"
         FROM enrollments e
         JOIN classes c ON c.id = e.class_id AND c.deleted_at IS NULL
         JOIN editions ed ON ed.id = c.edition_id
        WHERE e.student_id = $1 AND e.deleted_at IS NULL
        ORDER BY e.enrolled_at DESC, e.id DESC`,
      [student.id],
    );
    const courses = await this.courses.getCourseSummaries([
      ...new Set(rows.map((row) => row.courseId)),
    ]);
    const coursesById = new Map(courses.map((course) => [course.id, course]));
    const rates = await this.attendanceRatesOf(rows.map((row) => row.id));

    const enrollments = rows.map((row) =>
      toStudentEnrollmentItem(
        row,
        this.courseOf(coursesById, row.courseId),
        rates.get(row.id) ?? null,
      ),
    );
    return { enrollments, summary: summarizeStudentEnrollments(enrollments) };
  }

  /**
   * The students of the screen of students when it filters by class or situation (section 19,
   * M12): `enrolled` (the default) lists the students with an active enrollment, in `classId` or in
   * any class; `not_enrolled` lists the students that are not archived and have none. A `classId`
   * that is not a class answers nobody enrolled and everybody not enrolled. By name, paginated and
   * searchable, each with the classes where she is active.
   */
  async listStudentsByEnrollment(
    query: ListStudentsByEnrollmentQueryDto,
  ): Promise<PaginatedResult<StudentByEnrollmentItemResponseDto>> {
    const situation = query.situation ?? StudentEnrollmentSituation.ENROLLED;
    const { page, limit } = normalizePagination(query);

    const active: Array<{ studentId: string }> = await this.dataSource.query(
      `SELECT DISTINCT student_id AS "studentId"
         FROM enrollments
        WHERE status = $1 AND deleted_at IS NULL AND ($2::uuid IS NULL OR class_id = $2::uuid)`,
      [EnrollmentStatus.ACTIVE, query.classId ?? null],
    );
    const activeIds = active.map((row) => row.studentId);
    if (situation === StudentEnrollmentSituation.ENROLLED && activeIds.length === 0) {
      return { data: [], total: 0, page, limit };
    }

    const students = await this.students.listStudentEntries(
      situation === StudentEnrollmentSituation.ENROLLED
        ? { onlyIds: activeIds, search: query.search, includeArchived: false }
        : { excludeIds: activeIds, search: query.search, includeArchived: false },
      { page, limit },
    );
    const currentClasses = await this.findCurrentClasses(
      students.data.map((student) => student.id),
    );

    return {
      data: students.data.map((student) => ({
        id: student.id,
        name: student.name,
        birthDate: student.birthDate,
        age: student.age,
        phone: student.phone,
        email: student.email,
        accessibilityNeed: student.accessibilityNeed,
        createdAt: student.createdAt,
        currentClasses: currentClasses.get(student.id) ?? [],
      })),
      total: students.total,
      page: students.page,
      limit: students.limit,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** The class of the URL, archived or not (404 when it is not there). */
  private async findClass(classId: string): Promise<SchoolClass> {
    const schoolClass = await this.dataSource
      .getRepository(SchoolClass)
      .findOne({ where: { id: classId } });
    if (schoolClass === null) throw classNotFound();

    return schoolClass;
  }

  /**
   * The classes where each student has an active enrollment, in ONE query for the whole page, the
   * most recent edition first, then the code ignoring case, then the id. A removed class is left
   * out. A student without one is not in the map (the caller reads it as no class). No ids, no
   * query.
   */
  private async findCurrentClasses(
    studentIds: readonly string[],
  ): Promise<Map<string, EnrollmentClassRefResponseDto[]>> {
    const byStudent = new Map<string, EnrollmentClassRefResponseDto[]>();
    if (studentIds.length === 0) return byStudent;

    const rows: CurrentClassRow[] = await this.dataSource.query(
      `SELECT e.student_id AS "studentId", c.id AS "classId", c.code AS "classCode",
              c.name AS "className", ed.id AS "editionId", ed.name AS "editionName"
         FROM enrollments e
         JOIN classes c ON c.id = e.class_id AND c.deleted_at IS NULL
         JOIN editions ed ON ed.id = c.edition_id
        WHERE e.student_id = ANY($1::uuid[]) AND e.status = $2 AND e.deleted_at IS NULL
        ORDER BY ed.name DESC, LOWER(c.code), c.id`,
      [[...studentIds], EnrollmentStatus.ACTIVE],
    );
    for (const row of rows) {
      const classes = byStudent.get(row.studentId);
      if (classes === undefined) byStudent.set(row.studentId, [toEnrollmentClassRef(row)]);
      else classes.push(toEnrollmentClassRef(row));
    }
    return byStudent;
  }

  /**
   * The attendance rate of each enrollment, in ONE call to the port for the whole page or history; no
   * enrollment, no call. One left out of the map has no roll call recorded: the caller reads null.
   */
  private async attendanceRatesOf(enrollmentIds: readonly string[]): Promise<Map<string, number>> {
    if (enrollmentIds.length === 0) return new Map();

    return this.attendance.attendanceRates(enrollmentIds);
  }

  /** The enrollment of a student of the page: the page only has the students of these rows. */
  private rowOf(
    byStudent: ReadonlyMap<string, ClassEnrollmentRow>,
    student: StudentListEntry,
  ): ClassEnrollmentRow {
    const row = byStudent.get(student.id);
    if (row === undefined) {
      throw new Error(`The student ${student.id} of the page has no enrollment in the class.`);
    }
    return row;
  }

  /**
   * The course of a class: the foreign key keeps it, so a missing one is a broken invariant. The one
   * place of that invariant for the history: the item and the summary are built from what it found.
   */
  private courseOf(
    coursesById: ReadonlyMap<string, CourseSummary>,
    courseId: string,
  ): CourseSummary {
    const course = coursesById.get(courseId);
    if (course === undefined) throw new Error(`The course ${courseId} of a class is gone.`);

    return course;
  }
}
