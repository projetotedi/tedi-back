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
import { StudentAttendanceController } from "./controllers/student-attendance.controller";
import { AttendanceCorrection } from "./entities/attendance-correction.entity";
import { MemberAttendance } from "./entities/member-attendance.entity";
import { StudentAttendance } from "./entities/student-attendance.entity";
import { EnrollmentAttendanceReaderService } from "./services/enrollment-attendance-reader.service";
import { MemberAttendanceHistoryService } from "./services/member-attendance-history.service";
import { MemberAttendanceService } from "./services/member-attendance.service";
import { StudentAttendanceRecordsService } from "./services/student-attendance-records.service";
import { StudentRollCallCounterService } from "./services/student-roll-call-counter.service";
import { StudentRollCallAccess } from "./services/student-roll-call-access";
import { StudentRollCallService } from "./services/student-roll-call.service";

@Module({
  // As docs/ARCHITECTURE.md section 3 draws it (lessons, classes, assignments, hours and people <-
  // attendance):
  // - LessonsModule: the lesson whose attendance is signed (LessonsService.getLessonSummary, FOR
  //   SHARE inside the transaction) and the lessons of the history of a member (findLessonSummaries);
  //   and the port of the roll call of the students (LessonRollCallRegistry, GUS-166);
  // - ClassesModule (GUS-166): the class of the lesson of a roll call, FOR SHARE and archived or not
  //   (ClassesService.getClassSummary), who the roll call is made of (EnrollmentRosterService) and the
  //   port of the attendance of the enrollments (EnrollmentAttendanceRegistry);
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
    StudentAttendanceController,
  ],
  // Two providers plug themselves in a port in onModuleInit: StudentRollCallCounterService in the one
  // of the lessons (LessonRollCallRegistry: every answer of a lesson counts the roll call through it)
  // and EnrollmentAttendanceReaderService in the one of the classes (EnrollmentAttendanceRegistry:
  // the attendance rate of the enrollments, and the removal of one with attendance).
  providers: [
    MemberAttendanceService,
    MemberAttendanceHistoryService,
    StudentRollCallService,
    StudentAttendanceRecordsService,
    StudentRollCallAccess,
    StudentRollCallCounterService,
    EnrollmentAttendanceReaderService,
    Clock,
  ],
  // Nobody imports the attendance: what the others read of it goes through their ports.
  exports: [],
})
export class AttendanceModule {}
