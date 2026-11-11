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
import { ClassesService } from "./services/classes.service";
import { CourseClassesService } from "./services/course-classes.service";
import { EditionsService } from "./services/editions.service";
import { EnrollmentCountsService } from "./services/enrollment-counts.service";

@Module({
  // catalog <- classes and people <- classes, as docs/ARCHITECTURE.md section 3 draws it.
  // CatalogModule is in use since GUS-102: CoursesService.getCourseSummary validates the course of
  // a class and gives the `course` that every answer shows. PeopleModule has no consumer yet: the
  // first will be GUS-108 (StudentsService, for the enrollments).
  imports: [TypeOrmModule.forFeature([SchoolClass, Edition]), CatalogModule, PeopleModule],
  // CourseClassesController comes first on purpose: it holds GET /classes/summary-by-course, and
  // routes are registered in this order. The detail GET /classes/:id (GUS-104) lives in
  // ClassesController and would otherwise answer for "summary-by-course" as if it were an id.
  controllers: [CourseClassesController, ClassesController, EditionsController],
  providers: [
    ClassesService,
    CourseClassesService,
    EditionsService,
    EnrollmentCountsService,
    Clock,
  ],
  // Nobody consumes the classes yet: GUS-108 (enrollments, in this module) and the lessons module
  // (GUS-151) will say what they need, and the export is added then.
  exports: [],
})
export class ClassesModule {}
