import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ClassesModule } from "@modules/classes/classes.module";
import { LessonsModule } from "@modules/lessons/lessons.module";
import { PeopleModule } from "@modules/people/people.module";
import { Clock } from "@shared/dates/clock";
import { PermissionsModule } from "@shared/permissions/permissions.module";
import { HourEntriesController } from "./controllers/hour-entries.controller";
import { HoursController } from "./controllers/hours.controller";
import { MemberHoursViewController } from "./controllers/member-hours-view.controller";
import { MemberHoursController } from "./controllers/member-hours.controller";
import { MyHoursController } from "./controllers/my-hours.controller";
import { HourEntryEvent } from "./entities/hour-entry-event.entity";
import { HourEntry } from "./entities/hour-entry.entity";
import { HourEntryStatus } from "./enums/hour-entry-status.enum";
import { LessonCancelledListener } from "./listeners/lesson-cancelled.listener";
import { HoursExportService } from "./services/hours-export.service";
import { HoursReviewService } from "./services/hours-review.service";
import { HoursScopeService } from "./services/hours-scope.service";
import { HoursViewService } from "./services/hours-view.service";
import { HoursService } from "./services/hours.service";
import { LESSON_HOURS_INITIAL_STATUS, LessonHoursService } from "./services/lesson-hours.service";

/**
 * The bank of hours (E7). As docs/ARCHITECTURE.md section 3 draws it (people <- hours):
 * - PeopleModule: the member an entry on behalf is for (PeopleService.findRefsByIds) and her
 *   registration and department (MembersService.findAccessFacts); for the readings of the team
 *   (GUS-164), the ids, names and departments of the members by ids, department or search
 *   (MembersService.findMemberRefs) and who did each step of a history (PeopleService.findRefsByIds);
 * - PermissionsModule: the `department` scope of hours.logForOthers, hours.viewOthers and
 *   hours.export (PermissionPolicy).
 * - LessonsModule and ClassesModule: the lesson and the class an entry logged through a route is
 *   linked to (GUS-172), read FOR SHARE in its transaction (LessonsService.getLessonSummary and
 *   ClassesService.getClassSummary). Neither of them imports this module: the arrows are
 *   hours -> lessons -> classes, and the cancellation of a lesson still reaches here by event.
 *
 * It exports only the LessonHoursService (GUS-168): the attendance writes and reverses the lesson
 * hours inside its own transaction, because the row of the presence keeps the entry it generated
 * (`hourEntryId`). The cancellation of a lesson (RN-07) arrives by event (LessonCancelledListener).
 * LESSON_HOURS_INITIAL_STATUS: lesson hours are born `approved` (Q6.6 still open; `pending` sends
 * them to the queue of the review, GUS-164).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([HourEntry, HourEntryEvent]),
    PeopleModule,
    PermissionsModule,
    LessonsModule,
    ClassesModule,
  ],
  controllers: [
    MyHoursController,
    MemberHoursController,
    MemberHoursViewController,
    HoursController,
    HourEntriesController,
  ],
  providers: [
    HoursService,
    HoursViewService,
    HoursReviewService,
    HoursExportService,
    HoursScopeService,
    LessonHoursService,
    LessonCancelledListener,
    { provide: LESSON_HOURS_INITIAL_STATUS, useValue: HourEntryStatus.APPROVED },
    Clock,
  ],
  exports: [LessonHoursService],
})
export class HoursModule {}
