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
import { CourseDetailService } from "./services/course-detail.service";
import { CourseLessonPlansService } from "./services/course-lesson-plans.service";
import { CoursesService } from "./services/courses.service";
import { LessonPlansService } from "./services/lesson-plans.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LessonPlan,
      LessonPlanContent,
      Course,
      CoursePrerequisite,
      CourseLessonPlan,
    ]),
    // PeopleModule: name of who created the course (GUS-100).
    PeopleModule,
  ],
  controllers: [LessonPlansController, CoursesController, CourseLessonPlansController],
  providers: [
    LessonPlansService,
    CoursesService,
    CourseLessonPlansService,
    CourseDetailService,
    Clock,
  ],
  // The classes module reads the course (category, status) through getCourseSummary.
  exports: [CoursesService],
})
export class CatalogModule {}
