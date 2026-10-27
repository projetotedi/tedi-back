import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Clock } from "@shared/dates/clock";
import { CoursesController } from "./controllers/courses.controller";
import { LessonPlansController } from "./controllers/lesson-plans.controller";
import { CoursePrerequisite } from "./entities/course-prerequisite.entity";
import { Course } from "./entities/course.entity";
import { LessonPlanContent } from "./entities/lesson-plan-content.entity";
import { LessonPlan } from "./entities/lesson-plan.entity";
import { CoursesService } from "./services/courses.service";
import { LessonPlansService } from "./services/lesson-plans.service";

@Module({
  imports: [TypeOrmModule.forFeature([LessonPlan, LessonPlanContent, Course, CoursePrerequisite])],
  controllers: [LessonPlansController, CoursesController],
  providers: [LessonPlansService, CoursesService, Clock],
  // The classes module reads the course (category, status) through getCourseSummary.
  exports: [CoursesService],
})
export class CatalogModule {}
