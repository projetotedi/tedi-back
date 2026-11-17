import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CatalogModule } from "@modules/catalog/catalog.module";
import { PeopleModule } from "@modules/people/people.module";
import { Clock } from "@shared/dates/clock";
import { PermissionsModule } from "@shared/permissions/permissions.module";
import { ClassEnrollmentsController } from "./controllers/class-enrollments.controller";
import { ClassesController } from "./controllers/classes.controller";
import { CourseClassesController } from "./controllers/course-classes.controller";
import { EditionsController } from "./controllers/editions.controller";
import { EnrollmentsController } from "./controllers/enrollments.controller";
import { StudentEnrollmentsController } from "./controllers/student-enrollments.controller";
import { SchoolClass } from "./entities/class.entity";
import { Edition } from "./entities/edition.entity";
import { Enrollment } from "./entities/enrollment.entity";
import { ClassDetailService } from "./services/class-detail.service";
import { ClassesService } from "./services/classes.service";
import { CourseClassesService } from "./services/course-classes.service";
import { EditionsService } from "./services/editions.service";
import { EnrollmentAttendanceRegistry } from "./services/enrollment-attendance.registry";
import { EnrollmentCountsService } from "./services/enrollment-counts.service";
import { EnrollmentListingService } from "./services/enrollment-listing.service";
import { EnrollmentRosterService } from "./services/enrollment-roster.service";
import { EnrollmentsService } from "./services/enrollments.service";

@Module({
  // catalog <- classes and people <- classes, as docs/ARCHITECTURE.md section 3 draws it.
  // CatalogModule is in use since GUS-102: CoursesService.getCourseSummary validates the course of
  // a class and gives the `course` that every answer shows. Since GUS-104 it also gives
  // CourseLessonPlansService.readSequence, for the workload of the course on the sheet of the class.
  // PeopleModule has its first consumer in GUS-104 too: PeopleService.findRefsByIds, for who
  // created the class and the students of the preview. GUS-108 (the enrollments) uses
  // StudentsService.findStudentSummaries (the students of an enrollment, FOR SHARE on the profile)
  // and listStudentEntries (the students of the lists, by ids), CoursesService.findPrerequisiteRefs and
  // getCourseSummaries, and registers EnrollmentCountsService as the reader of the port
  // StudentEnrollmentsRegistry (the archive of a student asks it). PermissionsModule gives the
  // policy that decides whether the list of a class shows the contact of the students.
  imports: [
    TypeOrmModule.forFeature([SchoolClass, Edition, Enrollment]),
    CatalogModule,
    PeopleModule,
    PermissionsModule,
  ],
  // CourseClassesController comes first on purpose: it holds GET /classes/summary-by-course, and
  // routes are registered in this order. The detail GET /classes/:id (GUS-104) lives in
  // ClassesController and would otherwise answer for "summary-by-course" as if it were an id.
  // The controllers of the enrollments (GUS-108) come after the ones above: CourseClassesController
  // keeps the first place, and none of their routes clashes with `GET /classes/:id`.
  controllers: [
    CourseClassesController,
    ClassesController,
    EditionsController,
    ClassEnrollmentsController,
    EnrollmentsController,
    StudentEnrollmentsController,
  ],
  providers: [
    ClassesService,
    ClassDetailService,
    CourseClassesService,
    EditionsService,
    EnrollmentCountsService,
    EnrollmentsService,
    EnrollmentListingService,
    EnrollmentRosterService,
    EnrollmentAttendanceRegistry,
    Clock,
  ],
  // lessons reads the class (period, archived) through ClassesService.getClassSummary (GUS-151) and
  // the classes of its list and calendar (code, course, color slot) through
  // ClassesService.listClassRefs (GUS-153).
  // attendance (GUS-166): the class of a lesson FOR SHARE (ClassesService.getClassSummary), who the
  // roll call of a lesson is made of (EnrollmentRosterService) and the port where it plugs in the
  // reader of the attendance of the enrollments (EnrollmentAttendanceRegistry: the attendance rate
  // of the list and of the history, and "has attendance" before a removal). The arrow stays
  // attendance -> classes.
  exports: [ClassesService, EnrollmentRosterService, EnrollmentAttendanceRegistry],
})
export class ClassesModule {}
