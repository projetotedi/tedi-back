import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Clock } from "@shared/dates/clock";
import { MyHoursController } from "./controllers/my-hours.controller";
import { HourEntryEvent } from "./entities/hour-entry-event.entity";
import { HourEntry } from "./entities/hour-entry.entity";
import { HoursService } from "./services/hours.service";

/**
 * The bank of hours (E7). Nothing leaves the module (`exports: []`): the attendance (GUS-168) and
 * the cancellation of a lesson (RN-07) reach it through events, heard by listeners inside
 * `hours/listeners/` that call HoursService.createEntry (docs/ARCHITECTURE.md section 3).
 */
@Module({
  imports: [TypeOrmModule.forFeature([HourEntry, HourEntryEvent])],
  controllers: [MyHoursController],
  providers: [HoursService, Clock],
  exports: [],
})
export class HoursModule {}
