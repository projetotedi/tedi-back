import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AssignmentsModule } from "@modules/assignments/assignments.module";
import { HoursModule } from "@modules/hours/hours.module";
import { LessonsModule } from "@modules/lessons/lessons.module";
import { PeopleModule } from "@modules/people/people.module";
import { Clock } from "@shared/dates/clock";
import { PermissionsModule } from "@shared/permissions/permissions.module";
import { LessonMemberAttendanceController } from "./controllers/lesson-member-attendance.controller";
import { MemberAttendance } from "./entities/member-attendance.entity";
import { MemberAttendanceService } from "./services/member-attendance.service";

@Module({
  // As docs/ARCHITECTURE.md section 3 draws it (lessons, assignments, hours and people <- attendance):
  // - LessonsModule: the lesson whose attendance is signed (LessonsService.getLessonSummary, FOR
  //   SHARE inside the transaction) and the lessons of the history of a member (findLessonSummaries);
  // - AssignmentsModule: the confirmed assignments of a lesson, the targets of the attendance and its
  //   confirmed teacher (ConfirmedStaffService.findConfirmedAssignments, FOR SHARE);
  // - HoursModule: the lesson hours of a presence and their reversal, inside the transaction of the
  //   attendance (LessonHoursService). The arrow is attendance -> hours: hours never imports this one;
  // - PeopleModule: the names of the list of a lesson (PeopleService.findRefsByIds) and the member of
  //   a history (MembersService.getMemberSummary);
  // - PermissionsModule: PermissionPolicy checks attendance.confirmMember (lessonTeacher and the
  //   self-attendance rule), attendance.correct and the department scope of members.view.
  // Neither AuthModule nor ClassesModule: the guard is global, and the class of a lesson comes in its
  // summary.
  imports: [
    TypeOrmModule.forFeature([MemberAttendance]),
    LessonsModule,
    AssignmentsModule,
    HoursModule,
    PeopleModule,
    PermissionsModule,
  ],
  controllers: [LessonMemberAttendanceController],
  providers: [MemberAttendanceService, Clock],
  // Nobody consumes the attendance yet.
  exports: [],
})
export class AttendanceModule {}
