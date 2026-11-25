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
import { CourseListService } from "./services/course-list.service";
import { LessonPlanListService } from "./services/lesson-plan-list.service";
import { CourseLookupService } from "./services/course-lookup.service";
import { CoursesService } from "./services/courses.service";
import { LessonPlanUsageService } from "./services/lesson-plan-usage.service";
import { LessonPlansService } from "./services/lesson-plans.service";

@Module({
  imports: [
    // Name of who created a lesson plan (GUS-96) or a course (GUS-100), read from PeopleService.
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
    CourseDetailService,
    CourseListService,
    LessonPlanListService,
    CourseLookupService,
    Clock,
  ],
  // What the other modules read from the catalog:
  // - classes: the course (category, status) through CoursesService.getCourseSummary;
  // - lessons (GUS-151): the course name (CoursesService.getCourseSummary), the lesson plan a lesson
  //   is created from (LessonPlansService.getLessonPlanSummary) and the position of that plan in the
  //   sequence of the course (CourseLessonPlansService.findPosition);
  // - lessons (GUS-154): the whole sequence of a course with the title, the objective and the
  //   duration of each plan, to generate the lessons of a class (CourseLessonPlansService.
  //   getSequenceSummaries);
  // - classes (GUS-108): CoursesService.getCourseSummaries (the courses of the enrollment history of
  //   a student) and CoursesService.findPrerequisiteRefs (the prerequisites of the course of a class,
  //   for the warning of the enrollment);
  // - classes (GUS-103): the ids of the courses that match a name or a category, and the summary of
  //   the courses of a page of classes, in one query each (CourseLookupService).
  exports: [CoursesService, LessonPlansService, CourseLessonPlansService, CourseLookupService],
})
export class CatalogModule {}
