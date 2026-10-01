import { BadRequestException, HttpException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { randomBytes, createHash } from "node:crypto";
import { Role } from "@shared/enums/role.enum";
import { Person } from "@modules/people/entities/person.entity";
import { DepartmentsService } from "@modules/people/services/departments.service";
import { MembersService } from "@modules/people/services/members.service";
import { PeopleService } from "@modules/people/services/people.service";
import { PasswordService } from "./password.service";
import { Invite, InviteType } from "../entities/invite.entity";
import { CreateInviteDto } from "../dto/create-invite.dto";
import { AcceptInviteDto } from "../dto/accept-invite.dto";
import { InviteResponseDto } from "../dto/invite-response.dto";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";

/** Invite is valid for 48 hours. */
const INVITE_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * Computes the SHA-256 hex digest of the given token string.
 * This is stored as tokenHash; the raw token is never persisted.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Computed status of an invite for list display.
 */
export type InviteStatus = "pending" | "used" | "expired" | "revoked";

/**
 * Computes the display status of an invite without modifying it.
 */
function computeStatus(invite: Invite): InviteStatus {
  if (invite.revokedAt !== null) return "revoked";
  if (invite.usedAt !== null) return "used";
  if (invite.expiresAt < new Date()) return "expired";
  return "pending";
}

/**
 * Central validation used by both `getByToken` and `accept` — validates that
 * the invite is present, not used, not revoked, and not expired.
 * Does NOT check the invite type — callers handle type-specific logic.
 *
 * Throws 400 INVALID_INVITE when the invite is missing, used, revoked, or expired.
 */
function assertUsable(invite: Invite | null): asserts invite is Invite {
  if (
    !invite ||
    invite.usedAt !== null ||
    invite.revokedAt !== null ||
    invite.expiresAt < new Date()
  ) {
    throw invalidInvite();
  }
}

/**
 * Builds the 400 INVALID_INVITE error shared by every "this link is not usable" path.
 */
function invalidInvite(): HttpException {
  return new HttpException({ error: "INVALID_INVITE", message: "Invalid or expired invite." }, 400);
}

export interface InviteListItemDto {
  id: string;
  type: InviteType;
  role: Role | null;
  personId: string | null;
  status: InviteStatus;
  expiresAt: Date;
  createdAt: Date;
}

@Injectable()
export class InvitesService {
  constructor(
    @InjectRepository(Invite)
    private readonly inviteRepo: Repository<Invite>,
    private readonly dataSource: DataSource,
    private readonly passwordService: PasswordService,
    private readonly eventEmitter: EventEmitter2,
    private readonly peopleService: PeopleService,
    private readonly members: MembersService,
    private readonly departments: DepartmentsService,
  ) {}

  /**
   * Creates a new ACCESS invite for the given role.
   *
   * Rules:
   *  - SUPERADMIN cannot be assigned via invite (400 INVALID_ROLE).
   *  - Token is generated as 32 random bytes encoded as base64url.
   *  - Only the sha256(token) is persisted; the clear-text token is returned
   *    once in the response and never stored again.
   *  - INVITE_CREATED event is emitted AFTER the invite is saved.
   */
  async create(dto: CreateInviteDto, actorId: string): Promise<{ invite: Invite; token: string }> {
    if (dto.role === Role.SUPERADMIN) {
      throw new HttpException(
        { error: "INVALID_ROLE", message: "Role cannot be assigned via invite." },
        400,
      );
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const invite = this.inviteRepo.create({
      type: InviteType.ACCESS,
      role: dto.role,
      tokenHash,
      expiresAt,
      createdById: actorId,
      personId: null,
      usedAt: null,
      revokedAt: null,
    });

    const saved = await this.inviteRepo.save(invite);

    // Emit AFTER save — ensures event is not emitted if save fails.
    const event = new AuditableActionEvent();
    event.actorId = actorId;
    event.action = AuditableAction.INVITE_CREATED;
    event.targetType = "invite";
    event.targetId = saved.id;
    event.before = null;
    event.after = { role: saved.role, expiresAt: saved.expiresAt };
    event.occurredAt = new Date();
    this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, event);

    return { invite: saved, token };
  }

  /**
   * Creates a PASSWORD_RESET invite for the given person.
   * Returns { url, expiresAt }.
   *
   * Delegates token generation to the same mechanism as ACCESS invites.
   * PASSWORD_RESET_CREATED event is emitted AFTER save.
   */
  async createPasswordReset(
    personId: string,
    actorId: string,
    appUrl: string,
  ): Promise<{ url: string; expiresAt: Date }> {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const invite = this.inviteRepo.create({
      type: InviteType.PASSWORD_RESET,
      role: null,
      tokenHash,
      expiresAt,
      createdById: actorId,
      personId,
      usedAt: null,
      revokedAt: null,
    });

    const saved = await this.inviteRepo.save(invite);

    const event = new AuditableActionEvent();
    event.actorId = actorId;
    event.action = AuditableAction.PASSWORD_RESET_CREATED;
    event.targetType = "invite";
    event.targetId = saved.id;
    event.before = null;
    event.after = { personId, expiresAt: saved.expiresAt };
    event.occurredAt = new Date();
    this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, event);

    return { url: `${appUrl}/reset-password?token=${token}`, expiresAt };
  }

  /**
   * Lists all invites, optionally filtered by computed status.
   * Never includes tokenHash in the result.
   * Ordered by createdAt DESC.
   */
  async list(status?: InviteStatus): Promise<InviteListItemDto[]> {
    let queryBuilder = this.inviteRepo
      .createQueryBuilder("invite")
      .orderBy("invite.created_at", "DESC");

    if (status === "revoked") {
      queryBuilder = queryBuilder.where("invite.revoked_at IS NOT NULL");
    } else if (status === "used") {
      queryBuilder = queryBuilder.where("invite.revoked_at IS NULL AND invite.used_at IS NOT NULL");
    } else if (status === "expired") {
      queryBuilder = queryBuilder.where(
        "invite.revoked_at IS NULL AND invite.used_at IS NULL AND invite.expires_at < NOW()",
      );
    } else if (status === "pending") {
      queryBuilder = queryBuilder.where(
        "invite.revoked_at IS NULL AND invite.used_at IS NULL AND invite.expires_at >= NOW()",
      );
    }

    const invites = await queryBuilder.getMany();

    return invites.map((inv) => ({
      id: inv.id,
      type: inv.type,
      role: inv.role,
      personId: inv.personId,
      status: computeStatus(inv),
      expiresAt: inv.expiresAt,
      createdAt: inv.createdAt,
    }));
  }

  /**
   * Revokes a pending invite.
   *
   * Order:
   *  1. 404 if not found.
   *  2. 409 INVITE_ALREADY_USED if usedAt !== null.
   *  3. 409 INVITE_ALREADY_REVOKED if revokedAt !== null.
   *  4. Save revokedAt = now.
   *  5. Emit INVITE_REVOKED after save.
   */
  async revoke(id: string, actorId: string): Promise<void> {
    const invite = await this.inviteRepo.findOne({ where: { id } });

    if (invite === null) {
      throw new HttpException({ error: "NOT_FOUND", message: "Invite not found." }, 404);
    }

    if (invite.usedAt !== null) {
      throw new HttpException(
        { error: "INVITE_ALREADY_USED", message: "Invite already used." },
        409,
      );
    }

    if (invite.revokedAt !== null) {
      throw new HttpException(
        { error: "INVITE_ALREADY_REVOKED", message: "Invite already revoked." },
        409,
      );
    }

    invite.revokedAt = new Date();
    await this.inviteRepo.save(invite);

    const event = new AuditableActionEvent();
    event.actorId = actorId;
    event.action = AuditableAction.INVITE_REVOKED;
    event.targetType = "invite";
    event.targetId = invite.id;
    event.before = null;
    event.after = { revokedAt: invite.revokedAt };
    event.occurredAt = new Date();
    this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, event);
  }

  /**
   * Validates a raw token and returns the Invite if valid.
   * Throws 400 INVALID_INVITE when the token is not found, already used,
   * revoked, or expired.
   * Does NOT filter by type — the caller receives the invite with its type
   * so the front-end can choose the correct form.
   */
  async getByToken(token: string): Promise<Invite> {
    const tokenHash = hashToken(token);
    const invite = await this.inviteRepo.findOne({ where: { tokenHash } });
    assertUsable(invite);
    return invite;
  }

  /**
   * Public view of an invite for `GET /auth/invites/:token`.
   *
   * The invite is validated first (`getByToken`), so no Person is ever read for
   * a used, revoked, expired or unknown token.
   *
   * `person` is `null` for ACCESS invites, which carry `departments` instead: the list the
   * sign-up form offers (GUS-91; only a holder of a valid invite sees the names).
   * For PASSWORD_RESET invites `person` carries only the name and RA of the account
   * (explicit projection), so the reset screen can show whose password is being changed,
   * and `departments` is `[]` without querying anything.
   * A PASSWORD_RESET invite without a person, or whose person was deleted,
   * answers 400 INVALID_INVITE (same rule as `accept`). A person without an RA
   * also answers 400 INVALID_INVITE, but that rule exists only on this GET:
   * the reset screen needs an RA to show, and `accept` does not check it.
   */
  async getPublicView(token: string): Promise<InviteResponseDto> {
    const invite = await this.getByToken(token);
    const base = { type: invite.type, role: invite.role, expiresAt: invite.expiresAt };

    if (invite.type !== InviteType.PASSWORD_RESET) {
      return { ...base, departments: await this.departments.list(), person: null };
    }

    if (invite.personId === null) throw invalidInvite();

    const person = await this.peopleService.findById(invite.personId);
    if (person === null || !person.ra) throw invalidInvite();

    return { ...base, departments: [], person: { name: person.name, ra: person.ra } };
  }

  /**
   * Accepts an invite.
   *
   * Branches by invite type. The invite row is read with a lock (pessimistic_write): a double
   * click on the same link makes the second request wait and then fail with 400 INVALID_INVITE,
   * so one link never creates two registrations.
   *
   * ACCESS (GUS-91, RN-08):
   *  1. Validate token (same logic as getByToken).
   *  2. No `registration` in the body → 400 VALIDATION_FAILED with field `registration`
   *     (same shape as the ValidationPipe; the DTO cannot know the invite type).
   *  3. MembersService.submitFromInvite, in this transaction: creates (or reuses, RN-09) the
   *     Person WITHOUT access (role null, accessEnabled false) and a PENDING member profile.
   *     RA/e-mail conflicts (409) and unknown departments (400) come from there and roll the
   *     transaction back: the invite is not consumed.
   *  4. Mark invite.usedAt = now, invite.personId = person.id.
   *  5. AFTER the transaction commits: emit MEMBER_REGISTRATION_SUBMITTED. Access is only
   *     granted by the approval of coordination (MEMBER_REGISTRATION_APPROVED).
   *
   * PASSWORD_RESET (ignores `registration`):
   *  1. Validate token.
   *  2. invite.personId === null → 400 INVALID_INVITE (defensive).
   *  3. Load Person by invite.personId → null → 400 INVALID_INVITE.
   *  4. Update person.passwordHash.
   *  5. Mark invite.usedAt = now.
   *  6. AFTER the transaction commits: emit PASSWORD_RESET.
   */
  async accept(dto: AcceptInviteDto): Promise<void> {
    let eventToEmit: AuditableActionEvent;

    await this.dataSource.transaction(async (manager) => {
      const tokenHash = hashToken(dto.token);
      const invite = await manager.findOne(Invite, {
        where: { tokenHash },
        lock: { mode: "pessimistic_write" },
      });
      assertUsable(invite);

      if (invite.type === InviteType.PASSWORD_RESET) {
        // PASSWORD_RESET branch — only updates passwordHash
        if (invite.personId === null) {
          throw new HttpException(
            { error: "INVALID_INVITE", message: "Invalid or expired invite." },
            400,
          );
        }

        const person = await manager.findOne(Person, { where: { id: invite.personId } });
        if (person === null) {
          throw new HttpException(
            { error: "INVALID_INVITE", message: "Invalid or expired invite." },
            400,
          );
        }

        person.passwordHash = await this.passwordService.hashPassword(dto.password);
        await manager.save(Person, person);

        invite.usedAt = new Date();
        await manager.save(Invite, invite);

        // The endpoint is anonymous (link opened by the target): attribute the audit event to
        // the coordinator that ISSUED the reset (invite.createdById), not to the target.
        const event = new AuditableActionEvent();
        event.actorId = invite.createdById;
        event.action = AuditableAction.PASSWORD_RESET;
        event.targetType = "person";
        event.targetId = person.id;
        event.before = null;
        event.after = { personId: person.id };
        event.occurredAt = new Date();
        eventToEmit = event;
      } else {
        // ACCESS branch — registers the member as "A validar", without access.
        if (!dto.registration) {
          // Same shape the ValidationPipe produces → 400 VALIDATION_FAILED, details[0].field.
          throw new BadRequestException({
            error: "VALIDATION_FAILED",
            rawErrors: [
              { field: "registration", message: "registration is required for access invites" },
            ],
          });
        }

        const submission = await this.members.submitFromInvite(manager, {
          ...dto.registration,
          passwordHash: await this.passwordService.hashPassword(dto.password),
          requestedRole: invite.role,
          inviteId: invite.id,
        });

        invite.usedAt = new Date();
        invite.personId = submission.personId;
        await manager.save(Invite, invite);

        eventToEmit = submission.auditEvent;
      }
    });

    // Emit AFTER the transaction has committed.
    // Emitting inside the tx would risk leaking the event on rollback.
    this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, eventToEmit!);
  }
}
