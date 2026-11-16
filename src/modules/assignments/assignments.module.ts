import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LessonsModule } from "@modules/lessons/lessons.module";
import { PeopleModule } from "@modules/people/people.module";
import { Clock } from "@shared/dates/clock";
import { PermissionsModule } from "@shared/permissions/permissions.module";
import { AssignmentsController } from "./controllers/assignments.controller";
import { LessonApplicationsController } from "./controllers/lesson-applications.controller";
import { LessonAssignmentsController } from "./controllers/lesson-assignments.controller";
import { MemberAssignmentsController } from "./controllers/member-assignments.controller";
import { LessonAssignment } from "./entities/lesson-assignment.entity";
import { ApplicationsService } from "./services/applications.service";
import { AssignmentsService } from "./services/assignments.service";
import { LessonStaffCounterService } from "./services/lesson-staff-counter.service";

@Module({
  // As docs/ARCHITECTURE.md section 3 draws it (lessons <- assignments, people <- assignments):
  // - LessonsModule: the lesson an assignment is made for (LessonsService.getLessonSummary and
  //   findLessonSummaries) and the registry where the counter of the confirmed staff plugs in
  //   (LessonCoverageRegistry). The arrow is assignments -> lessons: lessons never imports this module;
  // - PeopleModule: whether the person is an active member (MembersService.getMemberSummary) and
  //   the name of the members (PeopleService.findRefsByIds);
  // - PermissionsModule: PermissionPolicy checks the department scope of GET /members/:id/assignments.
  // Neither AuthModule nor ClassesModule/CatalogModule: the guard is global, and the class and the
  // course of a lesson are not shown here.
  imports: [
    TypeOrmModule.forFeature([LessonAssignment]),
    LessonsModule,
    PeopleModule,
    PermissionsModule,
  ],
  controllers: [
    LessonAssignmentsController,
    LessonApplicationsController,
    AssignmentsController,
    MemberAssignmentsController,
  ],
  // LessonStaffCounterService plugs itself in the LessonCoverageRegistry in onModuleInit, so every
  // answer of the lessons counts the confirmed staff through it (F5.4).
  providers: [AssignmentsService, ApplicationsService, LessonStaffCounterService, Clock],
  // Nobody consumes the assignments yet: the attendance and the hours (GUS-166, GUS-168) will say
  // what they need, and the export is added then.
  exports: [],
})
export class AssignmentsModule {}
