import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Clock } from "@shared/dates/clock";
import { DepartmentsController } from "./controllers/departments.controller";
import { MemberRegistrationsController } from "./controllers/member-registrations.controller";
import { MyProfileController } from "./controllers/my-profile.controller";
import { StudentsController } from "./controllers/students.controller";
import { Department } from "./entities/department.entity";
import { MemberProfile } from "./entities/member-profile.entity";
import { Person } from "./entities/person.entity";
import { StudentProfile } from "./entities/student-profile.entity";
import { DepartmentsService } from "./services/departments.service";
import { MembersService } from "./services/members.service";
import { MyProfileService } from "./services/my-profile.service";
import { PeopleService } from "./services/people.service";
import { StudentsService } from "./services/students.service";

@Module({
  imports: [TypeOrmModule.forFeature([Person, StudentProfile, MemberProfile, Department])],
  controllers: [
    // MyProfileController (GET /members/me) goes FIRST: it has to be registered before any
    // controller with a `members/:id` route (GUS-144), or that route would catch "me" as an id.
    MyProfileController,
    StudentsController,
    MemberRegistrationsController,
    DepartmentsController,
  ],
  providers: [
    PeopleService,
    StudentsService,
    MembersService,
    MyProfileService,
    DepartmentsService,
    Clock,
  ],
  exports: [PeopleService, StudentsService, MembersService, DepartmentsService],
})
export class PeopleModule {}
