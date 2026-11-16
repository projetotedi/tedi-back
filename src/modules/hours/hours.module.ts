import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PeopleModule } from "@modules/people/people.module";
import { Clock } from "@shared/dates/clock";
import { PermissionsModule } from "@shared/permissions/permissions.module";
import { MemberHoursController } from "./controllers/member-hours.controller";
import { MyHoursController } from "./controllers/my-hours.controller";
import { HourEntryEvent } from "./entities/hour-entry-event.entity";
import { HourEntry } from "./entities/hour-entry.entity";
import { HoursService } from "./services/hours.service";

/**
 * The bank of hours (E7). As docs/ARCHITECTURE.md section 3 draws it (people <- hours):
 * - PeopleModule: the member an entry on behalf is for (PeopleService.findRefsByIds) and her
 *   registration and department (MembersService.findAccessFacts);
 * - PermissionsModule: the `department` scope of hours.logForOthers (PermissionPolicy).
 *
 * Nothing leaves the module (`exports: []`): the attendance (GUS-168) and the cancellation of a
 * lesson (RN-07) reach it through events, heard by listeners inside `hours/listeners/` that call
 * HoursService.createEntry.
 */
@Module({
  imports: [TypeOrmModule.forFeature([HourEntry, HourEntryEvent]), PeopleModule, PermissionsModule],
  controllers: [MyHoursController, MemberHoursController],
  providers: [HoursService, Clock],
  exports: [],
})
export class HoursModule {}
