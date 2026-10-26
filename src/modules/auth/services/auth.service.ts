import { HttpException, Injectable, UnauthorizedException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource } from "typeorm";
import { Person } from "@modules/people/entities/person.entity";
import { MemberRegistrationStatus } from "@modules/people/enums/member-registration-status.enum";
import { MembersService } from "@modules/people/services/members.service";
import { PeopleService } from "@modules/people/services/people.service";
import { ChangePasswordDto } from "../dto/change-password.dto";
import { LoginDto } from "../dto/login.dto";
import { MeResponseDto } from "../dto/me-response.dto";
import { PasswordService } from "./password.service";
import { Role } from "@shared/enums/role.enum";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { buildPermissionMap } from "@shared/permissions/permission-matrix";

@Injectable()
export class AuthService {
  constructor(
    private readonly people: PeopleService,
    private readonly password: PasswordService,
    private readonly members: MembersService,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Validates credentials and returns MeResponseDto on success.
   *
   * Security invariant — checks are performed in this exact order:
   * 1. findByRa (normalizes ra)
   * 2. person == null → verify(DUMMY_HASH, password) for constant-time → INVALID_CREDENTIALS
   * 3. passwordHash == null → INVALID_CREDENTIALS
   * 4. verify(passwordHash, password) == false → INVALID_CREDENTIALS
   * 5. member registration pending → REGISTRATION_PENDING; rejected → REGISTRATION_REJECTED
   *    (GUS-91, RN-08; only after the password is right, like ACCESS_DISABLED: decision 29)
   * 6. role == null → INVALID_CREDENTIALS
   * 7. !accessEnabled → ACCESS_DISABLED
   * 8. Return MeResponseDto (mustChangePassword does not stop the login, GUS-93)
   */
  async login(dto: LoginDto): Promise<MeResponseDto> {
    const person = await this.people.findByRa(dto.ra);

    if (person === null) {
      // Constant-time rejection: still run argon2 verify to avoid timing attacks.
      const dummyHash = await this.password.getDummyHash();
      await this.password.verify(dummyHash, dto.password);
      throw new HttpException(
        { error: "INVALID_CREDENTIALS", message: "Invalid credentials." },
        401,
      );
    }

    if (person.passwordHash === null) {
      throw new HttpException(
        { error: "INVALID_CREDENTIALS", message: "Invalid credentials." },
        401,
      );
    }

    const passwordOk = await this.password.verify(person.passwordHash, dto.password);
    if (!passwordOk) {
      throw new HttpException(
        { error: "INVALID_CREDENTIALS", message: "Invalid credentials." },
        401,
      );
    }

    // After the password (decision 29: nothing about the account is revealed before the
    // password is right). A person without member profile is not subject to validation.
    const facts = await this.members.findAccessFacts(person.id);
    if (facts.registrationStatus === MemberRegistrationStatus.PENDING) {
      throw new HttpException(
        { error: "REGISTRATION_PENDING", message: "Registration awaiting validation." },
        401,
      );
    }
    if (facts.registrationStatus === MemberRegistrationStatus.REJECTED) {
      throw new HttpException(
        {
          error: "REGISTRATION_REJECTED",
          message: "Registration rejected. Contact coordination.",
        },
        401,
      );
    }

    if (person.role === null) {
      throw new HttpException(
        { error: "INVALID_CREDENTIALS", message: "Invalid credentials." },
        401,
      );
    }

    if (!person.accessEnabled) {
      throw new HttpException(
        { error: "ACCESS_DISABLED", message: "Access disabled. Contact coordination." },
        401,
      );
    }

    return this.toMe(person, person.role);
  }

  /**
   * Loads a fresh Person from DB and returns MeResponseDto.
   * Throws 401 UNAUTHORIZED if person not found or role is null.
   */
  async getMe(userId: string): Promise<MeResponseDto> {
    const person = await this.people.findById(userId);

    if (person === null || person.role === null) {
      throw new UnauthorizedException();
    }

    return this.toMe(person, person.role);
  }

  /**
   * Replaces the password of the logged-in account while a change is required (GUS-93,
   * decision 16). The body carries only the new password: the session proves who is asking.
   *
   * One transaction, with the Person row locked, so two simultaneous requests cannot both find
   * the flag on and both succeed:
   *  1. person missing or without role → 401 UNAUTHORIZED
   *  2. flag off → 409 PASSWORD_CHANGE_NOT_REQUIRED (nothing is verified, hashed or emitted)
   *  3. new password equal to the current one → 400 PASSWORD_UNCHANGED. Accepting it would
   *     leave the account on the password the operator knows (ADMIN_PASSWORD), which is exactly
   *     what the change exists to replace.
   *  4. hash the new password and clear the flag
   * AFTER the commit, PASSWORD_CHANGED is emitted without the password or any hash.
   * The session is kept: the cookie carries only the person id, so no new cookie is issued.
   */
  async changeOwnPassword(userId: string, dto: ChangePasswordDto): Promise<MeResponseDto> {
    const { person, role } = await this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(Person, {
        where: { id: userId },
        lock: { mode: "pessimistic_write" },
      });
      if (locked === null || locked.role === null) {
        throw new UnauthorizedException();
      }
      const lockedRole = locked.role;

      if (!locked.mustChangePassword) {
        throw new HttpException(
          { error: "PASSWORD_CHANGE_NOT_REQUIRED", message: "Password change not required." },
          409,
        );
      }

      if (
        locked.passwordHash !== null &&
        (await this.password.verify(locked.passwordHash, dto.newPassword))
      ) {
        throw new HttpException(
          {
            error: "PASSWORD_UNCHANGED",
            message: "New password must be different from the current one.",
          },
          400,
        );
      }

      locked.passwordHash = await this.password.hashPassword(dto.newPassword);
      locked.mustChangePassword = false;
      return { person: await manager.save(Person, locked), role: lockedRole };
    });

    // Emit AFTER the transaction has committed: nothing leaks on rollback.
    const event = new AuditableActionEvent();
    event.actorId = person.id;
    event.action = AuditableAction.PASSWORD_CHANGED;
    event.targetType = "person";
    event.targetId = person.id;
    event.before = { mustChangePassword: true };
    event.after = { mustChangePassword: false };
    event.occurredAt = new Date();
    this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, event);

    return this.toMe(person, role);
  }

  private toMe(person: Person, role: Role): MeResponseDto {
    return {
      id: person.id,
      name: person.name,
      ra: person.ra,
      email: person.email,
      role,
      permissions: buildPermissionMap(role),
      mustChangePassword: person.mustChangePassword,
    };
  }
}
