import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Clock } from "@shared/dates/clock";
import { DepartmentsController } from "./controllers/departments.controller";
import { MemberRegistrationsController } from "./controllers/member-registrations.controller";
import { StudentsController } from "./controllers/students.controller";
import { Department } from "./entities/department.entity";
import { MemberProfile } from "./entities/member-profile.entity";
import { Person } from "./entities/person.entity";
import { StudentProfile } from "./entities/student-profile.entity";
import { DepartmentsService } from "./services/departments.service";
import { MembersService } from "./services/members.service";
import { PeopleService } from "./services/people.service";
import { StudentsService } from "./services/students.service";

@Module({
  imports: [TypeOrmModule.forFeature([Person, StudentProfile, MemberProfile, Department])],
  controllers: [StudentsController, MemberRegistrationsController, DepartmentsController],
  providers: [PeopleService, StudentsService, MembersService, DepartmentsService, Clock],
  exports: [PeopleService, StudentsService, MembersService, DepartmentsService],
})
export class PeopleModule {}
