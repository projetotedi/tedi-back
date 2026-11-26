import { Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource, IsNull } from "typeorm";
import { v7 as uuidv7 } from "uuid";
import { MembersService } from "@modules/people/services/members.service";
import { Clock } from "@shared/dates/clock";
import { AuthUser } from "@shared/decorators/auth-user.type";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { Permission } from "@shared/permissions/permission.enum";
import { PermissionPolicy } from "@shared/permissions/permission.policy";
import { HourCategoryNoteResponseDto } from "../dto/hour-category-note.response.dto";
import { SetHourCategoryNoteDto } from "../dto/set-hour-category-note.dto";
import { HourCategoryNote } from "../entities/hour-category-note.entity";
import { HourEntryCategory } from "../enums/hour-entry-category.enum";
import { memberNotFound } from "./hour-entry-errors";

const HOUR_CATEGORY_NOTE_TARGET_TYPE = "hour_category_note";

/** One row of the upsert, as Postgres returns it. */
interface NoteRow {
  id: string;
  person_id: string;
  category: HourEntryCategory;
  note: string | null;
  updated_by_id: string;
  updated_at: Date;
}

/**
 * The observations of coordination on the hours of a member, one per category (GUS-173): free
 * text, with no period, shown in the summary of Meu perfil and of the hours of the member.
 */
@Injectable()
export class HourCategoryNotesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly clock: Clock,
    private readonly members: MembersService,
    private readonly permissions: PermissionPolicy,
  ) {}

  /**
   * The observations of one person, by category; the cleared ones are left out. One query.
   */
  async notesOf(personId: string): Promise<Map<string, string>> {
    const rows = await this.dataSource.getRepository(HourCategoryNote).find({
      select: { category: true, note: true },
      where: { personId, deletedAt: IsNull() },
    });
    return new Map(
      rows.flatMap((row) => (row.note === null ? [] : [[row.category, row.note] as const])),
    );
  }

  /**
   * `PUT /members/:id/hours/notes`: coordination writes, changes or clears (null or blank) the
   * observation of one category of a member. hours.review, the permission of the review (RN-06):
   * only coordination and the superadmin.
   *
   * The member is a row of `GET /members`, as in `GET /members/:id/hours`, where the observation is
   * read: a student, an unknown or a deleted person answers 404 MEMBER_NOT_FOUND, before the scope.
   *
   * One statement, an upsert on the unique index of person and category: two writes at the same
   * time leave one row, with the last one. Emits HOUR_CATEGORY_NOTE_UPDATED after it, with whether
   * there is an observation and never its text (RNF-13).
   */
  async setNote(
    requestedPersonId: string,
    dto: SetHourCategoryNoteDto,
    actor: AuthUser,
  ): Promise<HourCategoryNoteResponseDto> {
    const member = (await this.members.findMemberRefs({ ids: [requestedPersonId] })).at(0);
    if (member === undefined) throw memberNotFound();
    this.permissions.assertCan(actor, Permission.HOURS_REVIEW, {
      personId: member.id,
      departmentIds: member.department === null ? [] : [member.department.id],
    });

    const now = this.clock.now();
    const note = dto.note ?? null;
    const rows: NoteRow[] = await this.dataSource.query(
      `INSERT INTO "hour_category_notes"
         ("id", "person_id", "category", "note", "updated_by_id", "created_at", "updated_at")
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       ON CONFLICT ("person_id", "category") WHERE "deleted_at" IS NULL
       DO UPDATE SET "note" = EXCLUDED."note",
                     "updated_by_id" = EXCLUDED."updated_by_id",
                     "updated_at" = EXCLUDED."updated_at"
       RETURNING "id", "person_id", "category", "note", "updated_by_id", "updated_at"`,
      [uuidv7(), member.id, dto.category, note, actor.id, now],
    );
    const saved = rows.at(0);
    if (saved === undefined) throw new Error("The upsert of the observation returned no row.");

    this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, this.auditEventOf(saved, actor.id, now));

    return {
      personId: saved.person_id,
      category: saved.category,
      note: saved.note,
      updatedById: saved.updated_by_id,
      updatedAt: saved.updated_at,
    };
  }

  private auditEventOf(saved: NoteRow, actorId: string, now: Date): AuditableActionEvent {
    const event = new AuditableActionEvent();
    event.actorId = actorId;
    event.action = AuditableAction.HOUR_CATEGORY_NOTE_UPDATED;
    event.targetType = HOUR_CATEGORY_NOTE_TARGET_TYPE;
    event.targetId = saved.id;
    event.before = null;
    event.after = {
      personId: saved.person_id,
      category: saved.category,
      hasNote: saved.note !== null,
    };
    event.occurredAt = now;
    return event;
  }
}
