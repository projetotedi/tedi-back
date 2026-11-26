import { Injectable } from "@nestjs/common";
import { DataSource, SelectQueryBuilder } from "typeorm";
import { LessonsService } from "@modules/lessons/services/lessons.service";
import { MemberRefDto } from "@modules/people/dto/member-ref.response.dto";
import { MembersService } from "@modules/people/services/members.service";
import { PeopleService } from "@modules/people/services/people.service";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { normalizePagination, PaginatedResult } from "@shared/pagination/pagination.util";
import { Permission } from "@shared/permissions/permission.enum";
import { PermissionPolicy } from "@shared/permissions/permission.policy";
import { HourEntryEventResponseDto } from "../dto/hour-entry-event.response.dto";
import { HoursOverviewQueryDto } from "../dto/hours-overview-query.dto";
import { HoursOverviewResponseDto } from "../dto/hours-overview.response.dto";
import { HoursPageQueryDto } from "../dto/hours-page-query.dto";
import { HoursPeriodQueryDto } from "../dto/hours-period-query.dto";
import { HoursSummaryResponseDto } from "../dto/hours-summary.response.dto";
import { ListHourEntriesQueryDto } from "../dto/list-hour-entries-query.dto";
import { MemberHourEntryResponseDto } from "../dto/member-hour-entry.response.dto";
import { MemberHoursResponseDto } from "../dto/member-hours.response.dto";
import { HourEntryEvent } from "../entities/hour-entry-event.entity";
import { HourEntry } from "../entities/hour-entry.entity";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";
import { hourEntryNotFound, memberNotFound } from "./hour-entry-errors";
import { findCancelledLessonIds } from "./hour-entry-lessons";
import { toHourEntryResponse } from "./hour-entry-response.mapper";
import {
  applyPopulation,
  applyQueueOrder,
  applyStatementOrder,
  HoursPopulation,
  isNobody,
  peoplePopulation,
  selectSummaryRows,
} from "./hour-entry-queries";
import { HoursScopeService } from "./hours-scope.service";
import { BANK_STATUSES, buildHoursSummary } from "./hours-summary";
import {
  HoursMemberRow,
  toHourEntryEventResponse,
  toHoursMemberTotal,
  toMemberHourEntry,
} from "./hours-view.mappers";
import { applyPeriod, assertValidPeriod } from "./hours.service";

/** The period as the summary echoes it: null for an open end. */
function periodOf(query: HoursPeriodQueryDto): { from: string | null; to: string | null } {
  return { from: query.from ?? null, to: query.to ?? null };
}

/**
 * The readings of the hours of the team (GUS-164): the overview, the hours of a member, the queue
 * of validation and the history of an entry. Read only: no transaction, no lock, no event. Removed
 * entries are left out of every reading but the history.
 *
 * Whose entries an actor reads comes from HoursScopeService (the department scope as a list of
 * people, filtered in the query); names and departments come from the people module
 * (MembersService.findMemberRefs, PeopleService.findRefsByIds), whose tables this module never
 * reads.
 */
@Injectable()
export class HoursViewService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly scope: HoursScopeService,
    private readonly members: MembersService,
    private readonly people: PeopleService,
    private readonly permissions: PermissionPolicy,
    private readonly lessons: LessonsService,
  ) {}

  /**
   * `GET /hours/overview` (F7.4): the totals of the period and a page of the members, for the
   * members the actor reads with hours.viewOthers (a director: her current department; coordination
   * and the superadmin: everyone), narrowed by the search, which narrows the totals too. The
   * totals and the table match, unless a review commits between their reads: they are separate
   * statements, with no transaction. The stored data stays right; only that answer can disagree.
   *
   * The lines are the members with entries in the period: the most pending minutes first, then the
   * most declared minutes, then the person id, paginated in the query. The name lives in people, so
   * it does not take part in the order.
   *
   * Three reads, one after the other (one connection per request): the totals, the page, the count
   * of members; then the names of the page in one call to findMemberRefs. 400 INVALID_PERIOD before
   * anything; nobody in the scope answers zero totals and an empty page without querying.
   */
  async getOverview(
    actor: AuthUser,
    query: HoursOverviewQueryDto,
  ): Promise<HoursOverviewResponseDto> {
    assertValidPeriod(query);
    const { page, limit } = normalizePagination(query);

    const population = await this.scope.populationOf(
      actor,
      Permission.HOURS_VIEW_OTHERS,
      query.search,
    );
    if (isNobody(population)) {
      return {
        summary: buildHoursSummary([], periodOf(query)),
        members: { data: [], total: 0, page, limit },
      };
    }

    const summary = await this.readSummary(query, population);
    const rows = await this.readMemberTotals(query, population, page, limit);
    const total = await this.countMembers(query, population);
    const members = await this.memberRefsOf(rows.map((row) => row.personId));

    return {
      summary,
      members: {
        data: rows.map((row) => toHoursMemberTotal(row, members.get(row.personId) ?? null)),
        total,
        page,
        limit,
      },
    };
  }

  /**
   * `GET /members/:id/hours` (F7.4): one member, her totals in the period (by status and by
   * category, with the pending ones) and a page of her entries, the most recent day first, each
   * with its review note.
   *
   * The member is a row of `GET /members` (an access role or a member registration): a student, an
   * unknown or a deleted person answers 404 MEMBER_NOT_FOUND, BEFORE the 403 FORBIDDEN_SCOPE of a
   * director outside the department of the approved registration of the member. Coordination
   * without a member profile opens here too. 400 INVALID_PERIOD before anything.
   */
  async getMemberHours(
    requestedPersonId: string,
    actor: AuthUser,
    query: HoursPageQueryDto,
  ): Promise<MemberHoursResponseDto> {
    assertValidPeriod(query);
    const { page, limit } = normalizePagination(query);

    const member = (await this.members.findMemberRefs({ ids: [requestedPersonId] })).at(0);
    if (member === undefined) throw memberNotFound();
    this.permissions.assertCan(actor, Permission.HOURS_VIEW_OTHERS, {
      personId: member.id,
      departmentIds: member.department === null ? [] : [member.department.id],
    });

    const population = peoplePopulation([member.id]);
    const summary = await this.readSummary(query, population);

    const builder = this.entries();
    applyPeriod(builder, query);
    applyPopulation(builder, population);
    applyStatementOrder(builder);
    const [entries, total] = await builder
      .offset((page - 1) * limit)
      .limit(limit)
      .getManyAndCount();

    const cancelled = await findCancelledLessonIds(this.lessons, entries);

    return {
      member,
      summary,
      entries: {
        data: entries.map((entry) => toHourEntryResponse(entry, cancelled)),
        total,
        page,
        limit,
      },
    };
  }

  /**
   * `GET /hour-entries`: the queue of validation (F7.3). The entries of one status (pending by
   * default) of the members the actor reads with hours.viewOthers, the oldest day first, each with
   * whose it is. Filters by person and period. The entries of the actor herself come too (she
   * cannot review them: 409 SELF_REVIEW_NOT_ALLOWED). 400 INVALID_PERIOD before querying; nobody in
   * the scope answers an empty page without querying.
   */
  async listEntries(
    actor: AuthUser,
    query: ListHourEntriesQueryDto,
  ): Promise<PaginatedResult<MemberHourEntryResponseDto>> {
    assertValidPeriod(query);
    const { page, limit } = normalizePagination(query);

    const population = await this.scope.populationOf(actor, Permission.HOURS_VIEW_OTHERS);
    if (isNobody(population)) return { data: [], total: 0, page, limit };

    const builder = this.entries().where("entry.status = :status", {
      status: query.status ?? HourEntryStatus.PENDING,
    });
    applyPeriod(builder, query);
    applyPopulation(builder, population);
    if (query.personId !== undefined) {
      builder.andWhere("entry.person_id = :personId", { personId: query.personId });
    }
    applyQueueOrder(builder);

    const [entries, total] = await builder
      .offset((page - 1) * limit)
      .limit(limit)
      .getManyAndCount();
    const members = await this.memberRefsOf(entries.map((entry) => entry.personId));
    const cancelled = await findCancelledLessonIds(this.lessons, entries);

    return {
      data: entries.map((entry) =>
        toMemberHourEntry(entry, members.get(entry.personId) ?? null, cancelled),
      ),
      total,
      page,
      limit,
    };
  }

  /**
   * `GET /hour-entries/:id/history`: every row of the history of an entry, in the order
   * `created_at, id`, with who did it and when. A removed entry keeps its history readable
   * (`withDeleted`).
   *
   * The person of the entry reads her own (account.manageOwn); hours.viewOthers reads the others'
   * within its scope (a director: the current department of the person; coordination and the
   * superadmin: anyone). Nobody else reads someone else's. 404 HOUR_ENTRY_NOT_FOUND (unknown) before
   * 403 FORBIDDEN_SCOPE.
   */
  async getHistory(requestedId: string, actor: AuthUser): Promise<HourEntryEventResponseDto[]> {
    const entry = await this.dataSource
      .getRepository(HourEntry)
      .findOne({ where: { id: requestedId }, withDeleted: true });
    if (entry === null) throw hourEntryNotFound();

    const facts = await this.members.findAccessFacts(entry.personId);
    this.permissions.assertCanAny(
      actor,
      [Permission.ACCOUNT_MANAGE_OWN, Permission.HOURS_VIEW_OTHERS],
      { personId: entry.personId, departmentIds: facts.departmentIds },
    );

    const events = await this.dataSource.getRepository(HourEntryEvent).find({
      where: { hourEntryId: entry.id },
      order: { createdAt: "ASC", id: "ASC" },
    });
    const actors = await this.people.findRefsByIds([
      ...new Set(events.map((event) => event.actorId)),
    ]);
    const actorsById = new Map(actors.map((person) => [person.id, person]));

    return events.map((event) =>
      toHourEntryEventResponse(event, actorsById.get(event.actorId) ?? null),
    );
  }

  private async readSummary(
    period: HoursPeriodQueryDto,
    population: HoursPopulation,
  ): Promise<HoursSummaryResponseDto> {
    const builder = this.entries();
    applyPeriod(builder, period);
    applyPopulation(builder, population);
    return buildHoursSummary(await selectSummaryRows(builder), periodOf(period));
  }

  /** A page of the totals of each member; the statuses go as parameters, never in the SQL text. */
  private readMemberTotals(
    period: HoursPeriodQueryDto,
    population: HoursPopulation,
    page: number,
    limit: number,
  ): Promise<HoursMemberRow[]> {
    const builder = this.entries()
      .select("entry.person_id", "personId")
      .addSelect("COUNT(*)::int", "entries")
      .addSelect("COALESCE(SUM(entry.declared_minutes), 0)::int", "declaredMinutes")
      .addSelect(
        "COALESCE(SUM(entry.validated_minutes) FILTER (WHERE entry.status IN (:...bankStatuses)), 0)::int",
        "bankMinutes",
      )
      .addSelect("(COUNT(*) FILTER (WHERE entry.status = :pending))::int", "pendingEntries")
      .addSelect(
        "COALESCE(SUM(entry.declared_minutes) FILTER (WHERE entry.status = :pending), 0)::int",
        "pendingMinutes",
      )
      .setParameters({
        pending: HourEntryStatus.PENDING,
        bankStatuses: [...BANK_STATUSES],
      });
    applyPeriod(builder, period);
    applyPopulation(builder, population);

    return builder
      .groupBy("entry.person_id")
      .orderBy('"pendingMinutes"', "DESC")
      .addOrderBy('"declaredMinutes"', "DESC")
      .addOrderBy("entry.person_id", "ASC")
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany<HoursMemberRow>();
  }

  /** How many members have entries in the period, under the same filters as the page. */
  private async countMembers(
    period: HoursPeriodQueryDto,
    population: HoursPopulation,
  ): Promise<number> {
    const builder = this.entries().select("COUNT(DISTINCT entry.person_id)::int", "total");
    applyPeriod(builder, period);
    applyPopulation(builder, population);

    const counted = await builder.getRawOne<{ total: unknown }>();
    if (
      counted === undefined ||
      typeof counted.total !== "number" ||
      !Number.isInteger(counted.total)
    ) {
      throw new Error("Hours overview count that is not a whole number.");
    }
    return counted.total;
  }

  private entries(): SelectQueryBuilder<HourEntry> {
    return this.dataSource.getRepository(HourEntry).createQueryBuilder("entry");
  }

  /**
   * The members of a page, by id, in one call (none for an empty page); a person no longer found is
   * not in the map.
   */
  private async memberRefsOf(personIds: readonly string[]): Promise<Map<string, MemberRefDto>> {
    if (personIds.length === 0) return new Map();
    const refs = await this.members.findMemberRefs({ ids: [...new Set(personIds)] });
    return new Map(refs.map((ref) => [ref.id, ref]));
  }
}
