import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CatalogModule } from "@modules/catalog/catalog.module";
import { PeopleModule } from "@modules/people/people.module";
import { Clock } from "@shared/dates/clock";
import { ClassesController } from "./controllers/classes.controller";
import { CourseClassesController } from "./controllers/course-classes.controller";
import { EditionsController } from "./controllers/editions.controller";
import { SchoolClass } from "./entities/class.entity";
import { Edition } from "./entities/edition.entity";
import { ClassDetailService } from "./services/class-detail.service";
import { ClassesService } from "./services/classes.service";
import { CourseClassesService } from "./services/course-classes.service";
import { EditionsService } from "./services/editions.service";
import { EnrollmentCountsService } from "./services/enrollment-counts.service";

@Module({
  // catalog <- classes and people <- classes, as docs/ARCHITECTURE.md section 3 draws it.
  // CatalogModule is in use since GUS-102: CoursesService.getCourseSummary validates the course of
  // a class and gives the `course` that every answer shows. Since GUS-104 it also gives
  // CourseLessonPlansService.readSequence, for the workload of the course on the sheet of the class.
  // PeopleModule has its first consumer in GUS-104 too: PeopleService.findRefsByIds, for who
  // created the class and the students of the preview. GUS-108 adds StudentsService, for the
  // enrollments.
  imports: [TypeOrmModule.forFeature([SchoolClass, Edition]), CatalogModule, PeopleModule],
  // CourseClassesController comes first on purpose: it holds GET /classes/summary-by-course, and
  // routes are registered in this order. The detail GET /classes/:id (GUS-104) lives in
  // ClassesController and would otherwise answer for "summary-by-course" as if it were an id.
  controllers: [CourseClassesController, ClassesController, EditionsController],
  providers: [
    ClassesService,
    ClassDetailService,
    CourseClassesService,
    EditionsService,
    EnrollmentCountsService,
    Clock,
  ],
  // lessons reads the class (period, archived) through ClassesService.getClassSummary (GUS-151) and
  // the classes of its list and calendar (code, course, color slot) through
  // ClassesService.listClassRefs (GUS-153).
  // The enrollments (GUS-108) live in this module, so they need no export.
  exports: [ClassesService],
})
export class ClassesModule {}
