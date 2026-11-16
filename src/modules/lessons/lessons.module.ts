import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CatalogModule } from "@modules/catalog/catalog.module";
import { ClassesModule } from "@modules/classes/classes.module";
import { Clock } from "@shared/dates/clock";
import { ClassLessonsController } from "./controllers/class-lessons.controller";
import { LessonsController } from "./controllers/lessons.controller";
import { Lesson } from "./entities/lesson.entity";
import { LessonCreationService } from "./services/lesson-creation.service";
import { LessonGenerationService } from "./services/lesson-generation.service";
import { LessonsService } from "./services/lessons.service";

@Module({
  // As docs/ARCHITECTURE.md section 3 draws it (classes <- lessons, catalog <- lessons):
  // - ClassesModule: the class, its period and whether it is archived (ClassesService.getClassSummary);
  // - CatalogModule: the name of the course (CoursesService.getCourseSummary), the lesson plan a
  //   lesson is created from (LessonPlansService.getLessonPlanSummary), the position of that
  //   plan in the sequence of the course (CourseLessonPlansService.findPosition) and, for the
  //   generation of the lessons of a class (GUS-154), the whole sequence with the title and the
  //   objective of each plan (CourseLessonPlansService.getSequenceSummaries).
  // Neither AuthModule nor PeopleModule: the guard is global and the routes only need the
  // permission, which has the scope all or none.
  imports: [TypeOrmModule.forFeature([Lesson]), ClassesModule, CatalogModule],
  // ClassLessonsController is the generation of the lessons of a class (GUS-154), which lives at
  // /classes/:id/lessons: the class is the resource there, so it is not in LessonsController.
  controllers: [LessonsController, ClassLessonsController],
  providers: [LessonsService, LessonGenerationService, LessonCreationService, Clock],
  // Nobody consumes the lessons yet: the allocation (GUS-158) and the attendance (GUS-166) will say
  // what they need, and the export is added then. LessonCreationService stays inside on purpose:
  // LessonsService and LessonGenerationService (GUS-154) both build lessons through it, so a lesson
  // of the series is born with the same rules as one of POST /lessons.
  exports: [],
})
export class LessonsModule {}
