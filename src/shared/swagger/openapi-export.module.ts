/**
 * Minimal NestJS module used exclusively by `scripts/openapi-runtime.ts` to
 * generate `docs/openapi.json` **without** connecting to the database or
 * starting an HTTP server.
 *
 * Rules for maintaining this file:
 * - NEVER import TypeOrmModule, AuthModule, ConfigModule, or any module that
 *   requires env variables or a database connection.
 * - When a new controller is added to the project, register it here so its
 *   routes appear in the exported contract.
 * - Provide a DataSource stub so controllers that inject DataSource
 *   (e.g. HealthController) can be instantiated without a real connection.
 */
import { Module } from "@nestjs/common";
import { DataSource } from "typeorm";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { ThrottlerStorage } from "@nestjs/throttler";
import { HealthController } from "@shared/health/health.controller";
import { ApplicationsController } from "@modules/assignments/controllers/applications.controller";
import { AssignmentsController } from "@modules/assignments/controllers/assignments.controller";
import { LessonApplicationsController } from "@modules/assignments/controllers/lesson-applications.controller";
import { LessonAssignmentsController } from "@modules/assignments/controllers/lesson-assignments.controller";
import { MemberAssignmentsController } from "@modules/assignments/controllers/member-assignments.controller";
import { MyAssignmentsController } from "@modules/assignments/controllers/my-assignments.controller";
import { AuthController } from "@modules/auth/auth.controller";
import { InvitesController } from "@modules/auth/invites.controller";
import { AccessController } from "@modules/auth/access.controller";
import { CourseLessonPlansController } from "@modules/catalog/controllers/course-lesson-plans.controller";
import { CoursesController } from "@modules/catalog/controllers/courses.controller";
import { LessonPlansController } from "@modules/catalog/controllers/lesson-plans.controller";
import { ClassesController } from "@modules/classes/controllers/classes.controller";
import { CourseClassesController } from "@modules/classes/controllers/course-classes.controller";
import { EditionsController } from "@modules/classes/controllers/editions.controller";
import { ClassLessonsController } from "@modules/lessons/controllers/class-lessons.controller";
import { LessonsController } from "@modules/lessons/controllers/lessons.controller";
import { MemberHoursController } from "@modules/hours/controllers/member-hours.controller";
import { MyHoursController } from "@modules/hours/controllers/my-hours.controller";
import { HourEntriesController } from "@modules/hours/controllers/hour-entries.controller";
import { HoursController } from "@modules/hours/controllers/hours.controller";
import { MemberHoursViewController } from "@modules/hours/controllers/member-hours-view.controller";
import { LessonMemberAttendanceController } from "@modules/attendance/controllers/lesson-member-attendance.controller";
import { MemberAttendanceController } from "@modules/attendance/controllers/member-attendance.controller";
import { DepartmentsController } from "@modules/people/controllers/departments.controller";
import { MembersController } from "@modules/people/controllers/members.controller";
import { MemberRegistrationsController } from "@modules/people/controllers/member-registrations.controller";
import { MyProfileController } from "@modules/people/controllers/my-profile.controller";
import { StudentsController } from "@modules/people/controllers/students.controller";
import { ApplicationsService } from "@modules/assignments/services/applications.service";
import { AssignmentsService } from "@modules/assignments/services/assignments.service";
import { MyAssignmentsService } from "@modules/assignments/services/my-assignments.service";
import { AuthService } from "@modules/auth/services/auth.service";
import { InvitesService } from "@modules/auth/services/invites.service";
import { AccessService } from "@modules/auth/services/access.service";
import { CourseDetailService } from "@modules/catalog/services/course-detail.service";
import { CourseLessonPlansService } from "@modules/catalog/services/course-lesson-plans.service";
import { CoursesService } from "@modules/catalog/services/courses.service";
import { LessonPlanUsageService } from "@modules/catalog/services/lesson-plan-usage.service";
import { LessonPlansService } from "@modules/catalog/services/lesson-plans.service";
import { ClassDetailService } from "@modules/classes/services/class-detail.service";
import { ClassesService } from "@modules/classes/services/classes.service";
import { CourseClassesService } from "@modules/classes/services/course-classes.service";
import { EditionsService } from "@modules/classes/services/editions.service";
import { LessonGenerationService } from "@modules/lessons/services/lesson-generation.service";
import { LessonListingService } from "@modules/lessons/services/lesson-listing.service";
import { LessonsService } from "@modules/lessons/services/lessons.service";
import { HoursService } from "@modules/hours/services/hours.service";
import { HoursExportService } from "@modules/hours/services/hours-export.service";
import { HoursReviewService } from "@modules/hours/services/hours-review.service";
import { HoursViewService } from "@modules/hours/services/hours-view.service";
import { MemberAttendanceService } from "@modules/attendance/services/member-attendance.service";
import { MemberAttendanceHistoryService } from "@modules/attendance/services/member-attendance-history.service";
import { DepartmentsService } from "@modules/people/services/departments.service";
import { MembersService } from "@modules/people/services/members.service";
import { MyProfileService } from "@modules/people/services/my-profile.service";
import { StudentsService } from "@modules/people/services/students.service";
import { LoginThrottlerGuard } from "@modules/auth/guards/login-throttler.guard";

const THROTTLER_OPTIONS_TOKEN = "THROTTLER:MODULE_OPTIONS";

@Module({
  controllers: [
    HealthController,
    AuthController,
    InvitesController,
    AccessController,
    StudentsController,
    MemberRegistrationsController,
    DepartmentsController,
    MyProfileController,
    MembersController,
    LessonPlansController,
    CoursesController,
    CourseLessonPlansController,
    ClassesController,
    EditionsController,
    CourseClassesController,
    LessonsController,
    ClassLessonsController,
    LessonAssignmentsController,
    LessonApplicationsController,
    AssignmentsController,
    ApplicationsController,
    MemberAssignmentsController,
    MyAssignmentsController,
    MyHoursController,
    MemberHoursController,
    MemberHoursViewController,
    HoursController,
    HourEntriesController,
    LessonMemberAttendanceController,
    MemberAttendanceController,
  ],
  providers: [
    {
      provide: DataSource,
      useValue: { query: async () => [] },
    },
    {
      provide: AuthService,
      useValue: { login: async () => ({}), getMe: async () => ({}) },
    },
    {
      provide: InvitesService,
      useValue: {
        create: async () => ({}),
        getByToken: async () => ({}),
        getPublicView: async () => ({}),
        accept: async () => undefined,
        list: async () => [],
        revoke: async () => undefined,
        createPasswordReset: async () => ({}),
      },
    },
    {
      provide: AccessService,
      useValue: {
        listAccess: async () => ({ data: [], total: 0, page: 1, limit: 20 }),
        updateRole: async () => ({}),
        updateEnabled: async () => ({}),
        createPasswordReset: async () => ({}),
      },
    },
    {
      provide: StudentsService,
      useValue: {
        create: async () => ({}),
        update: async () => ({}),
        archive: async () => ({}),
        unarchive: async () => ({}),
        findByIds: async () => [],
        findDetail: async () => ({}),
      },
    },
    {
      provide: MembersService,
      useValue: {
        submitFromInvite: async () => ({}),
        findAccessFacts: async () => ({ registrationStatus: null, departmentIds: [] }),
        listRegistrations: async () => ({ data: [], total: 0, page: 1, limit: 20 }),
        listMembers: async () => ({ data: [], total: 0, page: 1, limit: 20 }),
        getMember: async () => ({}),
        deactivateMember: async () => ({}),
        reactivateMember: async () => ({}),
        updateMember: async () => ({}),
        getRegistration: async () => ({}),
        approve: async () => ({}),
        reject: async () => ({}),
      },
    },
    {
      provide: MyAssignmentsService,
      useValue: { listMine: async () => ({}), listOpen: async () => [] },
    },
    {
      provide: MyProfileService,
      useValue: { getMyProfile: async () => ({}) },
    },
    {
      provide: DepartmentsService,
      useValue: { list: async () => [], create: async () => ({}), exists: async () => false },
    },
    {
      provide: LessonPlansService,
      useValue: {
        create: async () => ({}),
        findById: async () => ({}),
        update: async () => ({}),
        archive: async () => ({}),
        unarchive: async () => ({}),
        duplicate: async () => ({}),
        getLessonPlanSummary: async () => null,
      },
    },
    {
      provide: LessonPlanUsageService,
      useValue: { getDetail: async () => ({}), getUsage: async () => ({}) },
    },
    {
      provide: CoursesService,
      useValue: {
        create: async () => ({}),
        update: async () => ({}),
        duplicate: async () => ({}),
        getCourseSummary: async () => null,
      },
    },
    {
      provide: CourseLessonPlansService,
      useValue: {
        list: async () => ({}),
        replace: async () => ({}),
        findPosition: async () => null,
        getSequenceSummaries: async () => [],
      },
    },
    {
      provide: CourseDetailService,
      useValue: { findDetail: async () => ({}) },
    },
    {
      provide: ClassesService,
      useValue: {
        create: async () => ({}),
        update: async () => ({}),
        archive: async () => ({}),
        unarchive: async () => ({}),
        getClassSummary: async () => null,
        listClassRefs: async () => [],
      },
    },
    {
      provide: ClassDetailService,
      useValue: { findDetail: async () => ({}) },
    },
    {
      provide: EditionsService,
      useValue: { list: async () => [], findOrCreate: async () => ({}) },
    },
    {
      provide: CourseClassesService,
      useValue: {
        listCourseClasses: async () => ({ data: [], total: 0, page: 1, limit: 20 }),
        summarizeByCourse: async () => [],
      },
    },
    {
      provide: LessonListingService,
      useValue: {
        list: async () => ({ data: [], total: 0, page: 1, limit: 20 }),
        listCalendar: async () => [],
      },
    },
    {
      provide: LessonsService,
      useValue: {
        create: async () => ({}),
        findById: async () => ({}),
        update: async () => ({}),
        cancel: async () => ({}),
        reschedule: async () => ({}),
      },
    },
    {
      provide: LessonGenerationService,
      useValue: { preview: async () => ({}), generate: async () => ({}) },
    },
    {
      provide: AssignmentsService,
      useValue: {
        create: async () => ({}),
        listByLesson: async () => [],
        confirm: async () => ({}),
        cancel: async () => ({}),
        listByMember: async () => [],
      },
    },
    {
      provide: ApplicationsService,
      useValue: {
        apply: async () => ({}),
        listPending: async () => ({ total: 0, lessons: [] }),
        approve: async () => ({}),
        reject: async () => ({}),
      },
    },
    {
      provide: HoursService,
      useValue: {
        createEntry: async () => ({}),
        logMyHours: async () => ({}),
        logHoursForMember: async () => ({}),
        listMyEntries: async () => ({ data: [], total: 0, page: 1, limit: 20 }),
        getMySummary: async () => ({}),
        removeMyEntry: async () => undefined,
      },
    },
    {
      provide: HoursViewService,
      useValue: {
        getOverview: async () => ({}),
        getMemberHours: async () => ({}),
        listEntries: async () => ({ data: [], total: 0, page: 1, limit: 20 }),
        getHistory: async () => [],
      },
    },
    {
      provide: HoursReviewService,
      useValue: {
        validateEntries: async () => [],
        adjustEntry: async () => ({}),
        rejectEntry: async () => ({}),
      },
    },
    {
      provide: HoursExportService,
      useValue: { exportCsv: async () => ({}) },
    },
    {
      provide: MemberAttendanceService,
      useValue: { listByLesson: async () => [], confirm: async () => [] },
    },
    {
      provide: MemberAttendanceHistoryService,
      useValue: { getByMember: async () => ({ totals: { present: 0, absent: 0 }, items: [] }) },
    },
    {
      provide: ConfigService,
      useValue: { getOrThrow: () => "http://localhost:5173" },
    },
    {
      provide: JwtService,
      useValue: { signAsync: async () => "" },
    },
    {
      provide: THROTTLER_OPTIONS_TOKEN,
      useValue: [{ ttl: 900000, limit: 10 }],
    },
    {
      provide: ThrottlerStorage,
      useValue: {
        increment: async () => ({
          totalHits: 0,
          timeToExpire: 0,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
      },
    },
    LoginThrottlerGuard,
  ],
})
export class OpenApiExportModule {}
