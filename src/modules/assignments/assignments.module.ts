import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LessonsModule } from "@modules/lessons/lessons.module";
import { PeopleModule } from "@modules/people/people.module";
import { Clock } from "@shared/dates/clock";
import { PermissionsModule } from "@shared/permissions/permissions.module";
import { ApplicationsController } from "./controllers/applications.controller";
import { AssignmentsController } from "./controllers/assignments.controller";
import { LessonApplicationsController } from "./controllers/lesson-applications.controller";
import { LessonAssignmentsController } from "./controllers/lesson-assignments.controller";
import { MemberAssignmentsController } from "./controllers/member-assignments.controller";
import { MyAssignmentsController } from "./controllers/my-assignments.controller";
import { LessonAssignment } from "./entities/lesson-assignment.entity";
import { ApplicationsService } from "./services/applications.service";
import { AssignmentsService } from "./services/assignments.service";
import { ConfirmedStaffService } from "./services/confirmed-staff.service";
import { LessonStaffCounterService } from "./services/lesson-staff-counter.service";
import { MyAssignmentsService } from "./services/my-assignments.service";

@Module({
  // As docs/ARCHITECTURE.md section 3 draws it (lessons <- assignments, people <- assignments):
  // - LessonsModule: the lesson an assignment is made for (LessonsService.getLessonSummary and
  //   findLessonSummaries), the registry where the counter of the confirmed staff plugs in
  //   (LessonCoverageRegistry) and, for the applications (GUS-160), the agenda with the class of each
  //   lesson (LessonListingService.findAgendaBetween and findAgendaByIds). Whether the class of the
  //   lesson is active comes through it too (GUS-178): getLessonWithClassActivity for the two writes
  //   that create, and `classActive` on the agenda. The arrow is assignments -> lessons: lessons
  //   never imports this module;
  // - PeopleModule: whether the person is an active member (MembersService.getMemberSummary) and
  //   the name of the members (PeopleService.findRefsByIds);
  // - PermissionsModule: PermissionPolicy checks the department scope of GET /members/:id/assignments
  //   and says who reads the note (the list of a lesson, and the queue of the applications).
  // Neither AuthModule nor ClassesModule/CatalogModule: the guard is global, and the class of a
  // lesson comes through the agenda of the lessons.
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
    ApplicationsController,
    MemberAssignmentsController,
    MyAssignmentsController,
  ],
  // LessonStaffCounterService plugs itself in the LessonCoverageRegistry in onModuleInit, so every
  // answer of the lessons counts the confirmed staff through it (F5.4).
  providers: [
    AssignmentsService,
    ApplicationsService,
    MyAssignmentsService,
    LessonStaffCounterService,
    ConfirmedStaffService,
    Clock,
  ],
  // The attendance reads the confirmed assignments of a lesson (ConfirmedStaffService): the members
  // whose attendance is signed (GUS-168), and the confirmed teacher and monitors who take the roll
  // call of the students, the scope `allocated` of attendance.takeStudents (GUS-166).
  exports: [ConfirmedStaffService],
})
export class AssignmentsModule {}
