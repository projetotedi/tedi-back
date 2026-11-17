import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AssignmentsModule } from "@modules/assignments/assignments.module";
import { ClassesModule } from "@modules/classes/classes.module";
import { HoursModule } from "@modules/hours/hours.module";
import { LessonsModule } from "@modules/lessons/lessons.module";
import { PeopleModule } from "@modules/people/people.module";
import { Clock } from "@shared/dates/clock";
import { PermissionsModule } from "@shared/permissions/permissions.module";
import { LessonMemberAttendanceController } from "./controllers/lesson-member-attendance.controller";
import { LessonStudentAttendanceController } from "./controllers/lesson-student-attendance.controller";
import { MemberAttendanceController } from "./controllers/member-attendance.controller";
import { AttendanceCorrection } from "./entities/attendance-correction.entity";
import { MemberAttendance } from "./entities/member-attendance.entity";
import { StudentAttendance } from "./entities/student-attendance.entity";
import { MemberAttendanceHistoryService } from "./services/member-attendance-history.service";
import { MemberAttendanceService } from "./services/member-attendance.service";
import { StudentRollCallCounterService } from "./services/student-roll-call-counter.service";
import { StudentRollCallGuard } from "./services/student-roll-call.guard";
import { StudentRollCallService } from "./services/student-roll-call.service";

@Module({
  // As docs/ARCHITECTURE.md section 3 draws it (lessons, classes, assignments, hours and people <-
  // attendance):
  // - LessonsModule: the lesson whose attendance is signed (LessonsService.getLessonSummary, FOR
  //   SHARE inside the transaction) and the lessons of the history of a member (findLessonSummaries);
  //   and the port of the roll call of the students (LessonRollCallRegistry, GUS-166);
  // - ClassesModule (GUS-166): the class of the lesson of a roll call, FOR SHARE and archived or not
  //   (ClassesService.getClassSummary), and who the roll call is made of (EnrollmentRosterService);
  // - AssignmentsModule: the confirmed assignments of a lesson, the targets of the attendance of the
  //   members, its confirmed teacher, and the allocated staff of the roll call of the students
  //   (ConfirmedStaffService.findConfirmedAssignments, FOR SHARE);
  // - HoursModule: the lesson hours of a presence and their reversal, inside the transaction of the
  //   attendance (LessonHoursService). The arrow is attendance -> hours: hours never imports this one;
  // - PeopleModule: the names of the lists of a lesson (PeopleService.findRefsByIds) and the member
  //   of a history (MembersService.getMemberSummary);
  // - PermissionsModule: PermissionPolicy checks attendance.confirmMember (lessonTeacher and the
  //   self-attendance rule), attendance.correct, attendance.takeStudents (allocated) and the
  //   department scope of members.view.
  // Not AuthModule: the guard is global.
  imports: [
    TypeOrmModule.forFeature([MemberAttendance, StudentAttendance, AttendanceCorrection]),
    LessonsModule,
    ClassesModule,
    AssignmentsModule,
    HoursModule,
    PeopleModule,
    PermissionsModule,
  ],
  // The controllers of the roll call of the students (GUS-166) come after the ones of the members:
  // no route clashes, and no shared schema changes its description.
  controllers: [
    LessonMemberAttendanceController,
    MemberAttendanceController,
    LessonStudentAttendanceController,
  ],
  // StudentRollCallCounterService plugs itself in the port of the lessons (LessonRollCallRegistry)
  // in onModuleInit, so every answer of the lessons counts the roll call through it.
  providers: [
    MemberAttendanceService,
    MemberAttendanceHistoryService,
    StudentRollCallService,
    StudentRollCallGuard,
    StudentRollCallCounterService,
    Clock,
  ],
  // Nobody imports the attendance: what the others read of it goes through their ports.
  exports: [],
})
export class AttendanceModule {}
