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
   * Validates a raw token and returns the Invite if valid.
   * Throws 400 INVALID_INVITE when the token is not found, already used,
   * revoked, or expired.
   */
  async getByToken(token: string): Promise<Invite> {
    const tokenHash = hashToken(token);
    const invite = await this.inviteRepo.findOne({ where: { tokenHash } });

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

    return invite;
  }

  /**
   * Accepts an invite and provisions a Person.
   *
   * Sequence (all inside a transaction):
   *  1. Validate token (same logic as getByToken).
   *  2. Normalize ra and email to lowercase.
   *  3. If Person by RA exists with role !== null → 409 RA_ALREADY_IN_USE.
   *  4. If Person by RA exists with role === null → update (RN-09).
   *  5. If email already taken by a different person → 409 EMAIL_ALREADY_IN_USE.
   *  6. Otherwise create new Person.
   *  7. Mark invite.usedAt = now, invite.personId = person.id.
   *  8. AFTER the transaction commits: emit ACCESS_CREATED.
   */
  async accept(dto: AcceptInviteDto): Promise<void> {
    let personIdForEvent: string;
    let personRoleForEvent: Role | null;

    await this.dataSource.transaction(async (manager) => {
      const tokenHash = hashToken(dto.token);
      const invite = await manager.findOne(Invite, { where: { tokenHash } });

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

      const ra = dto.ra.trim().toLowerCase();
      const email = dto.email.trim().toLowerCase();

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

        existingByRa.name = dto.name;
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
          name: dto.name,
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
      personRoleForEvent = person.role;
    });

    // Emit ACCESS_CREATED AFTER the transaction has committed.
    // Emitting inside the tx would risk leaking the event on rollback.
    const event = new AuditableActionEvent();
    event.actorId = personIdForEvent!;
    event.action = AuditableAction.ACCESS_CREATED;
    event.targetType = "person";
    event.targetId = personIdForEvent!;
    event.before = null;
    event.after = { role: personRoleForEvent! };
    event.occurredAt = new Date();
    this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, event);
  }
}
