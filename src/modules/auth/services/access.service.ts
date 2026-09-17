import { HttpException, Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Role } from "@shared/enums/role.enum";
import { Person } from "@modules/people/entities/person.entity";
import { PaginatedResult, normalizePagination } from "@shared/pagination/pagination.util";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { ListAccessQueryDto } from "../dto/list-access-query.dto";
import { UpdateAccessRoleDto } from "../dto/update-access-role.dto";
import { UpdateAccessEnabledDto } from "../dto/update-access-enabled.dto";
import { AccessResponseDto } from "../dto/access-response.dto";
import { InvitesService } from "./invites.service";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class AccessService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly invitesService: InvitesService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Lists people who have access (role IS NOT NULL).
   * Supports pagination, search by name/RA, and filter by role and enabled.
   * Ordered by name ASC.
   */
  async listAccess(query: ListAccessQueryDto): Promise<PaginatedResult<AccessResponseDto>> {
    const { page, limit } = normalizePagination(query);
    const skip = (page - 1) * limit;

    const repo = this.dataSource.getRepository(Person);
    let qb = repo
      .createQueryBuilder("person")
      .where("person.role IS NOT NULL")
      .orderBy("person.name", "ASC");

    if (query.search) {
      const term = `%${query.search.toLowerCase()}%`;
      qb = qb.andWhere("(LOWER(person.name) LIKE :term OR LOWER(person.ra) LIKE :term)", { term });
    }

    if (query.role !== undefined) {
      qb = qb.andWhere("person.role = :role", { role: query.role });
    }

    if (query.enabled !== undefined) {
      qb = qb.andWhere("person.access_enabled = :enabled", { enabled: query.enabled });
    }

    const [people, total] = await qb.skip(skip).take(limit).getManyAndCount();

    return {
      data: people.map((p) => this.toResponseDto(p)),
      total,
      page,
      limit,
    };
  }

  /**
   * Changes a person's role.
   *
   * Order (exact per plan):
   *  1. dto.role === SUPERADMIN → 400 INVALID_ROLE (before tx).
   *  2. assertNotSelf(actorId, id) → 403 OWN_ACCOUNT (before tx).
   *  3. SERIALIZABLE tx:
   *     a. findOne with pessimistic_write lock → 404 if null or role===null.
   *     b. If target.role === COORDINATOR && dto.role !== COORDINATOR →
   *        assertNotLastCoordinator(mgr) — skipped for SUPERADMIN actors.
   *     c. Save new role.
   *  4. After commit: emit ROLE_CHANGED.
   */
  async updateRole(
    id: string,
    dto: UpdateAccessRoleDto,
    actorId: string,
    actorRole: Role,
  ): Promise<AccessResponseDto> {
    // 1. Reject SUPERADMIN before anything else.
    if (dto.role === Role.SUPERADMIN) {
      throw new HttpException(
        { error: "INVALID_ROLE", message: "Role cannot be assigned via API." },
        400,
      );
    }

    // 2. Self-action guard.
    this.assertNotSelf(actorId, id);

    let prevRole: Role | null;
    let updated: Person;

    // 3. Serializable transaction.
    await this.dataSource.transaction("SERIALIZABLE", async (mgr) => {
      const target = await mgr.findOne(Person, {
        where: { id },
        lock: { mode: "pessimistic_write" },
      });

      if (target === null || target.role === null) {
        throw new HttpException({ error: "NOT_FOUND", message: "Person not found." }, 404);
      }

      // b. Demoting a coordinator requires that there's at least one other active coordinator.
      // SUPERADMIN bypasses this check (decision confirmed in GUS-81 card).
      if (
        target.role === Role.COORDINATOR &&
        dto.role !== Role.COORDINATOR &&
        actorRole !== Role.SUPERADMIN
      ) {
        await this.assertNotLastCoordinator(mgr);
      }

      prevRole = target.role;
      target.role = dto.role;
      updated = await mgr.save(Person, target);
    });

    // 4. Emit after commit.
    const event = new AuditableActionEvent();
    event.actorId = actorId;
    event.action = AuditableAction.ROLE_CHANGED;
    event.targetType = "person";
    event.targetId = id;
    event.before = { role: prevRole! };
    event.after = { role: dto.role };
    event.occurredAt = new Date();
    this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, event);

    return this.toResponseDto(updated!);
  }

  /**
   * Enables or disables a person's access.
   *
   * Order (symmetric to updateRole):
   *  1. assertNotSelf(actorId, id) → 403 OWN_ACCOUNT (before tx).
   *  2. SERIALIZABLE tx:
   *     a. findOne with pessimistic_write lock → 404 if null or role===null.
   *     b. If target.role === COORDINATOR && dto.enabled === false →
   *        assertNotLastCoordinator(mgr) — skipped for SUPERADMIN actors.
   *     c. Save new enabled state.
   *  3. After commit: emit ACCESS_ENABLED or ACCESS_DISABLED.
   */
  async updateEnabled(
    id: string,
    dto: UpdateAccessEnabledDto,
    actorId: string,
    actorRole: Role,
  ): Promise<AccessResponseDto> {
    // 1. Self-action guard.
    this.assertNotSelf(actorId, id);

    let updated: Person;

    // 2. Serializable transaction.
    await this.dataSource.transaction("SERIALIZABLE", async (mgr) => {
      const target = await mgr.findOne(Person, {
        where: { id },
        lock: { mode: "pessimistic_write" },
      });

      if (target === null || target.role === null) {
        throw new HttpException({ error: "NOT_FOUND", message: "Person not found." }, 404);
      }

      // b. Disabling a coordinator requires that there's at least one other active coordinator.
      // SUPERADMIN bypasses this check (decision confirmed in GUS-81 card).
      if (
        target.role === Role.COORDINATOR &&
        dto.enabled === false &&
        actorRole !== Role.SUPERADMIN
      ) {
        await this.assertNotLastCoordinator(mgr);
      }

      target.accessEnabled = dto.enabled;
      updated = await mgr.save(Person, target);
    });

    // 3. Emit after commit.
    const event = new AuditableActionEvent();
    event.actorId = actorId;
    event.action = dto.enabled ? AuditableAction.ACCESS_ENABLED : AuditableAction.ACCESS_DISABLED;
    event.targetType = "person";
    event.targetId = id;
    event.before = null;
    event.after = { accessEnabled: dto.enabled };
    event.occurredAt = new Date();
    this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, event);

    return this.toResponseDto(updated!);
  }

  /**
   * Creates a PASSWORD_RESET invite for the given person and returns the URL.
   * Note: assertNotSelf is NOT applied — a coordinator may reset their own password.
   */
  async createPasswordReset(
    id: string,
    actorId: string,
  ): Promise<{ url: string; expiresAt: Date }> {
    const repo = this.dataSource.getRepository(Person);
    const person = await repo.findOne({ where: { id } });

    if (person === null || person.role === null) {
      throw new HttpException({ error: "NOT_FOUND", message: "Person not found." }, 404);
    }

    const appUrl = this.config.getOrThrow<string>("APP_URL");
    return this.invitesService.createPasswordReset(person.id, actorId, appUrl);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Throws 403 OWN_ACCOUNT if the actor is targeting themselves.
   */
  private assertNotSelf(actorId: string, targetId: string): void {
    if (actorId === targetId) {
      throw new HttpException(
        { error: "OWN_ACCOUNT", message: "Cannot act on your own account." },
        403,
      );
    }
  }

  /**
   * Counts active coordinators inside a transaction.
   * Throws 409 LAST_COORDINATOR if count <= 1.
   *
   * Called BEFORE the save that would remove/disable the last coordinator.
   * The target is already SELECT FOR UPDATE-locked so the count is stable.
   *
   * SUPERADMIN is not counted — only role=coordinator AND accessEnabled=true.
   */
  private async assertNotLastCoordinator(mgr: EntityManager): Promise<void> {
    const count = await mgr.count(Person, {
      where: { role: Role.COORDINATOR, accessEnabled: true },
    });

    if (count <= 1) {
      throw new HttpException(
        {
          error: "LAST_COORDINATOR",
          message: "Cannot demote or disable the last active coordinator.",
        },
        409,
      );
    }
  }

  private toResponseDto(person: Person): AccessResponseDto {
    return {
      id: person.id,
      name: person.name,
      ra: person.ra,
      email: person.email,
      role: person.role,
      accessEnabled: person.accessEnabled,
    };
  }
}
