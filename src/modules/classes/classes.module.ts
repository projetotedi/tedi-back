import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CatalogModule } from "@modules/catalog/catalog.module";
import { PeopleModule } from "@modules/people/people.module";
import { Clock } from "@shared/dates/clock";
import { ClassesController } from "./controllers/classes.controller";
import { EditionsController } from "./controllers/editions.controller";
import { SchoolClass } from "./entities/class.entity";
import { Edition } from "./entities/edition.entity";
import { ClassesService } from "./services/classes.service";
import { EditionsService } from "./services/editions.service";
import { EnrollmentCountsService } from "./services/enrollment-counts.service";

@Module({
  // CatalogModule and PeopleModule enter now, as docs/ARCHITECTURE.md section 3 draws it
  // (catalog <- classes, people <- classes). Nothing in this card calls them yet: the consumers are
  // GUS-102 (CoursesService.getCourseSummary, to validate the course of the class) and GUS-108
  // (StudentsService, for the enrollments).
  imports: [TypeOrmModule.forFeature([SchoolClass, Edition]), CatalogModule, PeopleModule],
  controllers: [ClassesController, EditionsController],
  providers: [ClassesService, EditionsService, EnrollmentCountsService, Clock],
  // lessons reads the class (period, archived) through ClassesService.getClassSummary (GUS-151).
  // The enrollments (GUS-108) live in this module, so they need no export.
  exports: [ClassesService],
})
export class ClassesModule {}
