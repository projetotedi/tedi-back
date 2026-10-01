import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Clock } from "@shared/dates/clock";
import { StudentsController } from "./controllers/students.controller";
import { Department } from "./entities/department.entity";
import { MemberProfile } from "./entities/member-profile.entity";
import { Person } from "./entities/person.entity";
import { StudentProfile } from "./entities/student-profile.entity";
import { PeopleService } from "./services/people.service";
import { StudentsService } from "./services/students.service";

@Module({
  imports: [TypeOrmModule.forFeature([Person, StudentProfile, MemberProfile, Department])],
  controllers: [StudentsController],
  providers: [PeopleService, StudentsService, Clock],
  exports: [PeopleService, StudentsService],
})
export class PeopleModule {}
