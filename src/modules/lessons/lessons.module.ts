import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CatalogModule } from "@modules/catalog/catalog.module";
import { ClassesModule } from "@modules/classes/classes.module";
import { Clock } from "@shared/dates/clock";
import { LessonsController } from "./controllers/lessons.controller";
import { Lesson } from "./entities/lesson.entity";
import { LessonCreationService } from "./services/lesson-creation.service";
import { LessonListingService } from "./services/lesson-listing.service";
import { LessonsService } from "./services/lessons.service";

@Module({
  // As docs/ARCHITECTURE.md section 3 draws it (classes <- lessons, catalog <- lessons):
  // - ClassesModule: the class, its period and whether it is archived (ClassesService.getClassSummary),
  //   and the classes of the list and the calendar, with their course and color slot
  //   (ClassesService.listClassRefs, GUS-153: the lessons read no table of `classes`);
  // - CatalogModule: the name of the course (CoursesService.getCourseSummary), the lesson plan a
  //   lesson is created from (LessonPlansService.getLessonPlanSummary) and the position of that
  //   plan in the sequence of the course (CourseLessonPlansService.findPosition).
  // Neither AuthModule nor PeopleModule: the guard is global and the routes only need the
  // permission, which has the scope all or none.
  imports: [TypeOrmModule.forFeature([Lesson]), ClassesModule, CatalogModule],
  controllers: [LessonsController],
  providers: [LessonsService, LessonListingService, LessonCreationService, Clock],
  // Nobody consumes the lessons yet: the allocation (GUS-158) and the attendance (GUS-166) will say
  // what they need, and the export is added then. LessonCreationService stays inside on purpose:
  // the series of lessons of a class (GUS-154) is in this module and reuses it from here.
  exports: [],
})
export class LessonsModule {}
