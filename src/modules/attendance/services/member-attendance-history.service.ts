import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { LessonsService, LessonStatus } from "@modules/lessons/services/lessons.service";
import { MembersService } from "@modules/people/services/members.service";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { Permission } from "@shared/permissions/permission.enum";
import { PermissionPolicy } from "@shared/permissions/permission.policy";
import { MemberAttendanceHistoryResponseDto } from "../dto/member-attendance-history.response.dto";
import { MemberAttendance } from "../entities/member-attendance.entity";
import { MemberAttendanceStatus } from "../enums/member-attendance-status.enum";
import { memberNotFound } from "./attendance-errors";
import { toMemberAttendanceHistoryItem } from "./member-attendance-response.mapper";

/**
 * The attendance history of a member for her record (F6.4, GUS-168): the lessons she was at, and
 * missed, as teacher or monitor. The member comes from MembersService and the lessons from
 * LessonsService: this module touches no table of another one.
 */
@Injectable()
export class MemberAttendanceHistoryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly members: MembersService,
    private readonly lessons: LessonsService,
    private readonly policy: PermissionPolicy,
  ) {}

  /**
   * `GET /members/:id/attendance`: the presences and absences of a member with the totals, the
   * latest lesson first (day, then start time, both descending, then the id of the row). A row whose
   * lesson is cancelled (or no longer answered by the lessons) is left out of the items AND of the
   * totals: a cancelled lesson did not happen (RN-07), so an absence in it is not an absence. That
   * filter runs after loading, because the status lives in `lessons`; the list is not paginated, so
   * nothing is lost (risk 5 of docs/ARCHITECTURE.md section 18).
   *
   * 404 MEMBER_NOT_FOUND for an id that is not a member (the predicate of the member record), BEFORE
   * the scope. Scope (`members.view`): coordination and the superadmin read every member; a director
   * only a member of the own department (403 FORBIDDEN_SCOPE otherwise, and for a director without
   * one). The lessons come from ONE call to `LessonsService.findLessonSummaries`, and a member
   * without attendance reads none. A plain read: no transaction, no lock and no event.
   */
  async getByMember(
    personId: string,
    actor: AuthUser,
  ): Promise<MemberAttendanceHistoryResponseDto> {
    const member = await this.members.getMemberSummary(personId);
    if (member === null) throw memberNotFound();

    this.policy.assertCan(actor, Permission.MEMBERS_VIEW, {
      personId: member.id,
      departmentIds: member.departmentIds,
    });

    const rows = await this.dataSource
      .getRepository(MemberAttendance)
      .find({ where: { personId: member.id } });
    if (rows.length === 0) return { totals: { present: 0, absent: 0 }, items: [] };

    const summaries = await this.lessons.findLessonSummaries(rows.map((row) => row.lessonId));
    const lessonsById = new Map(summaries.map((lesson) => [lesson.id, lesson]));

    const kept = rows
      .flatMap((row) => {
        const lesson = lessonsById.get(row.lessonId);
        return lesson === undefined || lesson.status === LessonStatus.CANCELLED
          ? []
          : [{ row, lesson }];
      })
      .sort(
        (a, b) =>
          b.lesson.date.localeCompare(a.lesson.date) ||
          b.lesson.startTime.localeCompare(a.lesson.startTime) ||
          a.row.id.localeCompare(b.row.id),
      );

    return {
      totals: {
        present: kept.filter(({ row }) => row.status === MemberAttendanceStatus.PRESENT).length,
        absent: kept.filter(({ row }) => row.status === MemberAttendanceStatus.ABSENT).length,
      },
      items: kept.map(({ row, lesson }) => toMemberAttendanceHistoryItem(row, lesson)),
    };
  }
}
