import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PeopleModule } from "@modules/people/people.module";
import { Clock } from "@shared/dates/clock";
import { PermissionsModule } from "@shared/permissions/permissions.module";
import { HourEntriesController } from "./controllers/hour-entries.controller";
import { MemberHoursController } from "./controllers/member-hours.controller";
import { MyHoursController } from "./controllers/my-hours.controller";
import { HourEntryEvent } from "./entities/hour-entry-event.entity";
import { HourEntry } from "./entities/hour-entry.entity";
import { HoursReviewService } from "./services/hours-review.service";
import { HoursScopeService } from "./services/hours-scope.service";
import { HoursViewService } from "./services/hours-view.service";
import { HoursService } from "./services/hours.service";

/**
 * The bank of hours (E7). As docs/ARCHITECTURE.md section 3 draws it (people <- hours):
 * - PeopleModule: the member an entry on behalf is for (PeopleService.findRefsByIds) and her
 *   registration and department (MembersService.findAccessFacts); for the readings of the team
 *   (GUS-164), the ids, names and departments of the members by ids, department or search
 *   (MembersService.findMemberRefs) and who did each step of a history (PeopleService.findRefsByIds);
 * - PermissionsModule: the `department` scope of hours.logForOthers, hours.viewOthers and
 *   hours.export (PermissionPolicy).
 *
 * Nothing leaves the module (`exports: []`): the attendance (GUS-168) and the cancellation of a
 * lesson (RN-07) reach it through events, heard by listeners inside `hours/listeners/` that call
 * HoursService.createEntry.
 */
@Module({
  imports: [TypeOrmModule.forFeature([HourEntry, HourEntryEvent]), PeopleModule, PermissionsModule],
  controllers: [MyHoursController, MemberHoursController, HourEntriesController],
  providers: [HoursService, HoursViewService, HoursReviewService, HoursScopeService, Clock],
  exports: [],
})
export class HoursModule {}
