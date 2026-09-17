import { HttpException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { randomBytes, createHash } from "node:crypto";
import { Role } from "@shared/enums/role.enum";
import { Person } from "@modules/people/entities/person.entity";
import { PasswordService } from "./password.service";
import { Invite, InviteType } from "../entities/invite.entity";
import { CreateInviteDto } from "../dto/create-invite.dto";
import { AcceptInviteDto } from "../dto/accept-invite.dto";
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
    throw new HttpException(
      { error: "INVALID_INVITE", message: "Invalid or expired invite." },
      400,
    );
  }
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
   * Accepts an invite and provisions a Person.
   *
   * Branches by invite type:
   *
   * ACCESS:
   *  1. Validate token (same logic as getByToken).
   *  2. Normalize ra and email to lowercase.
   *  3. If Person by RA exists with role !== null → 409 RA_ALREADY_IN_USE.
   *  4. If Person by RA exists with role === null → update (RN-09).
   *  5. If email already taken by a different person → 409 EMAIL_ALREADY_IN_USE.
   *  6. Otherwise create new Person.
   *  7. Mark invite.usedAt = now, invite.personId = person.id.
   *  8. AFTER the transaction commits: emit ACCESS_CREATED.
   *
   * PASSWORD_RESET:
   *  1. Validate token.
   *  2. invite.personId === null → 400 INVALID_INVITE (defensive).
   *  3. Load Person by invite.personId → null → 400 INVALID_INVITE.
   *  4. Update person.passwordHash.
   *  5. Mark invite.usedAt = now.
   *  6. AFTER the transaction commits: emit PASSWORD_RESET.
   */
  async accept(dto: AcceptInviteDto): Promise<void> {
    let personIdForEvent: string;
    let actionForEvent: AuditableAction;
    // For PASSWORD_RESET the endpoint is anonymous (link opened by the target);
    // attribute the audit event to the coordinator that ISSUED the reset
    // (invite.createdById), not to the target. For ACCESS the invite acceptance
    // is also anonymous, but the actor is the person being provisioned.
    let actorIdForEvent: string;

    await this.dataSource.transaction(async (manager) => {
      const tokenHash = hashToken(dto.token);
      const invite = await manager.findOne(Invite, { where: { tokenHash } });
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

        personIdForEvent = person.id;
        actionForEvent = AuditableAction.PASSWORD_RESET;
        actorIdForEvent = invite.createdById;
      } else {
        // ACCESS branch — provisions a Person
        const ra = (dto.ra ?? "").trim().toLowerCase();
        const email = (dto.email ?? "").trim().toLowerCase();

        // Check for existing person by RA.
        const existingByRa = await manager.findOne(Person, { where: { ra } });

        let person: Person;

        if (existingByRa !== null) {
          if (existingByRa.role !== null) {
            // RA already belongs to an active account — reject without consuming invite.
            throw new HttpException(
              { error: "RA_ALREADY_IN_USE", message: "RA already in use." },
              409,
            );
          }

          // RN-09: reuse existing Person that has no role yet.
          // Check if the new email is already taken by a DIFFERENT person.
          if (email !== existingByRa.email) {
            const emailOwner = await manager.findOne(Person, { where: { email } });
            if (emailOwner !== null && emailOwner.id !== existingByRa.id) {
              throw new HttpException(
                { error: "EMAIL_ALREADY_IN_USE", message: "Email already in use." },
                409,
              );
            }
          }

          existingByRa.name = dto.name ?? existingByRa.name;
          existingByRa.email = email;
          existingByRa.ra = ra;
          existingByRa.passwordHash = await this.passwordService.hashPassword(dto.password);
          existingByRa.role = invite.role;
          existingByRa.accessEnabled = true;
          person = await manager.save(Person, existingByRa);
        } else {
          // No existing person by RA — check email uniqueness before create.
          const emailOwner = await manager.findOne(Person, { where: { email } });
          if (emailOwner !== null) {
            throw new HttpException(
              { error: "EMAIL_ALREADY_IN_USE", message: "Email already in use." },
              409,
            );
          }

          const newPerson = manager.create(Person, {
            name: dto.name ?? "",
            ra,
            email,
            passwordHash: await this.passwordService.hashPassword(dto.password),
            role: invite.role,
            accessEnabled: true,
          });
          person = await manager.save(Person, newPerson);
        }

        // Mark invite as used.
        invite.usedAt = new Date();
        invite.personId = person.id;
        await manager.save(Invite, invite);

        personIdForEvent = person.id;
        actionForEvent = AuditableAction.ACCESS_CREATED;
        // On accept-access, the acceptor IS the newly-provisioned person.
        actorIdForEvent = person.id;
      }
    });

    // Emit AFTER the transaction has committed.
    // Emitting inside the tx would risk leaking the event on rollback.
    const event = new AuditableActionEvent();
    event.actorId = actorIdForEvent!;
    event.action = actionForEvent!;
    event.targetType = "person";
    event.targetId = personIdForEvent!;
    event.before = null;
    event.after =
      actionForEvent! === AuditableAction.PASSWORD_RESET
        ? { personId: personIdForEvent! }
        : { personId: personIdForEvent! };
    event.occurredAt = new Date();
    this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, event);
  }
}
