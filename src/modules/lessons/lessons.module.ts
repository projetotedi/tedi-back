import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CatalogModule } from "@modules/catalog/catalog.module";
import { ClassesModule } from "@modules/classes/classes.module";
import { Clock } from "@shared/dates/clock";
import { LessonsController } from "./controllers/lessons.controller";
import { Lesson } from "./entities/lesson.entity";
import { LessonCoverageRegistry } from "./services/lesson-coverage.registry";
import { LessonCreationService } from "./services/lesson-creation.service";
import { LessonsService } from "./services/lessons.service";

@Module({
  // As docs/ARCHITECTURE.md section 3 draws it (classes <- lessons, catalog <- lessons):
  // - ClassesModule: the class, its period and whether it is archived (ClassesService.getClassSummary);
  // - CatalogModule: the name of the course (CoursesService.getCourseSummary), the lesson plan a
  //   lesson is created from (LessonPlansService.getLessonPlanSummary) and the position of that
  //   plan in the sequence of the course (CourseLessonPlansService.findPosition).
  // Neither AuthModule nor PeopleModule: the guard is global and the routes only need the
  // permission, which has the scope all or none.
  imports: [TypeOrmModule.forFeature([Lesson]), ClassesModule, CatalogModule],
  controllers: [LessonsController],
  providers: [LessonsService, LessonCreationService, LessonCoverageRegistry, Clock],
  // What the other modules read from the lessons:
  // - assignments (GUS-158): the lesson an assignment is made for (LessonsService.getLessonSummary
  //   and findLessonSummaries, with the status of the lesson re-exported) and the port through which
  //   it plugs in the counter of the confirmed staff (LessonCoverageRegistry), the coverage that
  //   every answer of this module shows. The arrow stays assignments -> lessons: this module never
  //   imports the other one.
  // The attendance (GUS-166) will say what it needs, and the export is added then.
  // LessonCreationService stays inside on purpose: the series of lessons of a class (GUS-154) is in
  // this module and reuses it from here.
  exports: [LessonsService, LessonCoverageRegistry],
})
export class LessonsModule {}
