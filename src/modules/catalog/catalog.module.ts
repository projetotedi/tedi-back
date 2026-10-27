import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PeopleModule } from "@modules/people/people.module";
import { Clock } from "@shared/dates/clock";
import { CourseLessonPlansController } from "./controllers/course-lesson-plans.controller";
import { CoursesController } from "./controllers/courses.controller";
import { LessonPlansController } from "./controllers/lesson-plans.controller";
import { CourseLessonPlan } from "./entities/course-lesson-plan.entity";
import { CoursePrerequisite } from "./entities/course-prerequisite.entity";
import { Course } from "./entities/course.entity";
import { LessonPlanContent } from "./entities/lesson-plan-content.entity";
import { LessonPlan } from "./entities/lesson-plan.entity";
import { CourseLessonPlansService } from "./services/course-lesson-plans.service";
import { CoursesService } from "./services/courses.service";
import { LessonPlanUsageService } from "./services/lesson-plan-usage.service";
import { LessonPlansService } from "./services/lesson-plans.service";

@Module({
  imports: [
    // The detail of a lesson plan shows who created it: PeopleService.findRefsByIds (GUS-96).
    PeopleModule,
    TypeOrmModule.forFeature([
      LessonPlan,
      LessonPlanContent,
      Course,
      CoursePrerequisite,
      CourseLessonPlan,
    ]),
  ],
  controllers: [LessonPlansController, CoursesController, CourseLessonPlansController],
  providers: [
    LessonPlansService,
    CoursesService,
    CourseLessonPlansService,
    LessonPlanUsageService,
    Clock,
  ],
  // The classes module reads the course (category, status) through getCourseSummary.
  exports: [CoursesService],
})
export class CatalogModule {}
