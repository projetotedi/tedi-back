import { Injectable } from "@nestjs/common";
import { DataSource, SelectQueryBuilder } from "typeorm";
import { MemberRefDto } from "@modules/people/dto/member-ref.response.dto";
import { MembersService } from "@modules/people/services/members.service";
import { PeopleService } from "@modules/people/services/people.service";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { normalizePagination, PaginatedResult } from "@shared/pagination/pagination.util";
import { Permission } from "@shared/permissions/permission.enum";
import { PermissionPolicy } from "@shared/permissions/permission.policy";
import { HourEntryEventResponseDto } from "../dto/hour-entry-event.response.dto";
import { ListHourEntriesQueryDto } from "../dto/list-hour-entries-query.dto";
import { MemberHourEntryResponseDto } from "../dto/member-hour-entry.response.dto";
import { HourEntryEvent } from "../entities/hour-entry-event.entity";
import { HourEntry } from "../entities/hour-entry.entity";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";
import { hourEntryNotFound } from "./hour-entry-errors";
import { applyPopulation, applyQueueOrder, isNobody } from "./hour-entry-queries";
import { HoursScopeService } from "./hours-scope.service";
import { toHourEntryEventResponse, toMemberHourEntry } from "./hours-view.mappers";
import { applyPeriod, assertValidPeriod } from "./hours.service";

/**
 * The readings of the hours of the team (GUS-164): the queue of validation and the history of an
 * entry. Read only: no transaction, no lock, no event. Removed entries are left out of every
 * reading but the history.
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
  ) {}

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

    return {
      data: entries.map((entry) => toMemberHourEntry(entry, members.get(entry.personId) ?? null)),
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

  private entries(): SelectQueryBuilder<HourEntry> {
    return this.dataSource.getRepository(HourEntry).createQueryBuilder("entry");
  }

  /** The members of a page, by id, in one call; a person no longer found is not in the map. */
  private async memberRefsOf(personIds: readonly string[]): Promise<Map<string, MemberRefDto>> {
    const refs = await this.members.findMemberRefs({ ids: [...new Set(personIds)] });
    return new Map(refs.map((ref) => [ref.id, ref]));
  }
}
