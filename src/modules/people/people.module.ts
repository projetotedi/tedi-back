import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Person } from "./entities/person.entity";
import { StudentProfile } from "./entities/student-profile.entity";
import { PeopleService } from "./services/people.service";

@Module({
  imports: [TypeOrmModule.forFeature([Person, StudentProfile])],
  providers: [PeopleService],
  exports: [PeopleService],
})
export class PeopleModule {}
