import { Injectable } from "@nestjs/common";
import { MemberRefFilter, MembersService } from "@modules/people/services/members.service";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { Permission } from "@shared/permissions/permission.enum";
import { PermissionPolicy } from "@shared/permissions/permission.policy";
import { normalizeSearchTerm } from "@shared/search/search.util";
import { EVERYONE, HoursPopulation, populationOf } from "./hour-entry-queries";

/**
 * Whose hours an actor reads on the readings of the team (overview, queue, export), turned into the
 * filter of the query and never applied after loading (docs/ARCHITECTURE.md section 9.1).
 */
@Injectable()
export class HoursScopeService {
  constructor(
    private readonly permissions: PermissionPolicy,
    private readonly members: MembersService,
  ) {}

  /**
   * The population of `permission` for the actor, narrowed by `search` (name or RA) when it is not
   * blank:
   * - `all` (coordination, superadmin): everyone, without asking the people module; with a search,
   *   the members it finds;
   * - `departments` (a director): the members of her department, with the search if any;
   * - `none` (a director without department): nobody, without asking the people module.
   *
   * The department is the CURRENT one, of the approved member registration (findMemberRefs). The
   * list has the size of a department or of a search in the team: tens to hundreds of ids, far
   * from the limit of parameters of Postgres.
   *
   * `own`, `allocated` and `lessonTeacher` throw: no permission of hours uses them, and turning one
   * into "nobody" or "everyone" without a word would hide the mistake.
   */
  async populationOf(
    actor: AuthUser,
    permission: Permission,
    search?: string,
  ): Promise<HoursPopulation> {
    const filter = this.permissions.listFilter(actor, permission);
    const searching = normalizeSearchTerm(search) !== undefined;

    switch (filter.kind) {
      case "all":
        if (!searching) return EVERYONE;
        return this.populationOfRefs({ search });
      case "departments":
        return this.populationOfRefs({
          departmentIds: filter.departmentIds,
          search: searching ? search : undefined,
        });
      case "none":
        return populationOf([]);
      case "own":
      case "allocated":
      case "lessonTeacher":
        throw new Error(`Hours scope ${filter.kind} is not supported.`);
      default: {
        const unsupported: never = filter;
        throw new Error(`Hours scope ${JSON.stringify(unsupported)} is not supported.`);
      }
    }
  }

  private async populationOfRefs(filter: MemberRefFilter): Promise<HoursPopulation> {
    const refs = await this.members.findMemberRefs(filter);
    return populationOf(refs.map((ref) => ref.id));
  }
}
