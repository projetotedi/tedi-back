import { HttpException, Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource, EntityManager, In, QueryFailedError } from "typeorm";
import { Clock } from "@shared/dates/clock";
import { Role } from "@shared/enums/role.enum";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { normalizePagination, PaginatedResult } from "@shared/pagination/pagination.util";
import { ApproveMemberRegistrationDto } from "../dto/approve-member-registration.dto";
import { ListMemberRegistrationsQueryDto } from "../dto/list-member-registrations-query.dto";
import { MemberRegistrationFormDto } from "../dto/member-registration-form.dto";
import { MemberRegistrationListItemDto } from "../dto/member-registration-list-item.dto";
import { MemberRegistrationResponseDto } from "../dto/member-registration.response.dto";
import { RejectMemberRegistrationDto } from "../dto/reject-member-registration.dto";
import { Department } from "../entities/department.entity";
import { MemberProfile } from "../entities/member-profile.entity";
import { Person } from "../entities/person.entity";
import { MemberRegistrationStatus } from "../enums/member-registration-status.enum";
import { DepartmentsService } from "./departments.service";
import { buildMemberEvent } from "./member-audit";
import {
  toMemberRegistrationListItem,
  toMemberRegistrationResponse,
} from "./member-registration.mapper";

/**
 * What the AuthGuard and the login need to know about the member registration of a person.
 *  - registrationStatus: null = no member profile (seed superadmin, coordinators, accounts that
 *    predate GUS-91): not subject to validation.
 *  - departmentIds: the department of the APPROVED profile, or []. The department suggested at
 *    sign-up never gives scope.
 */
export interface MemberAccessFacts {
  registrationStatus: MemberRegistrationStatus | null;
  departmentIds: string[];
}

/**
 * Input of submitFromInvite: the form, the hash of the chosen password and what the invite
 * carries. The caller hashes the password (it owns the PasswordService).
 */
export type SubmitMemberRegistrationInput = MemberRegistrationFormDto & {
  passwordHash: string;
  requestedRole: Role | null;
  inviteId: string;
};

export interface MemberRegistrationSubmission {
  personId: string;
  /** Built here with the allow-list; the caller emits it AFTER its transaction commits. */
  auditEvent: AuditableActionEvent;
}

/**
 * The one place that builds the "member registration not found" error: an unknown id, a
 * malformed id and a person without a member profile all answer the same
 * 404 MEMBER_REGISTRATION_NOT_FOUND. Used by this service and by the id pipe of the controller.
 */
export function memberRegistrationNotFound(): HttpException {
  return new HttpException(
    { error: "MEMBER_REGISTRATION_NOT_FOUND", message: "Member registration not found." },
    404,
  );
}

function raAlreadyInUse(): HttpException {
  return new HttpException({ error: "RA_ALREADY_IN_USE", message: "RA already in use." }, 409);
}

function emailAlreadyInUse(): HttpException {
  return new HttpException(
    { error: "EMAIL_ALREADY_IN_USE", message: "Email already in use." },
    409,
  );
}

function departmentNotFound(): HttpException {
  return new HttpException(
    { error: "DEPARTMENT_NOT_FOUND", message: "Department not found." },
    400,
  );
}

/** Escapes the wildcards of LIKE so a search for "100%" is a literal search. */
function likeTerm(search: string): string {
  return `%${search
    .trim()
    .toLowerCase()
    .replace(/[\\%_]/g, "\\$&")}%`;
}

/**
 * Member registration and its validation by coordination (GUS-91, RN-08, RF-004, RF-011).
 *
 * The registration is born from an access invite (submitFromInvite, called by the invites in
 * the transaction of the accept) as PENDING with no access: Person.role stays null and
 * accessEnabled false. Only the approval grants the role and the access. Rejected people can
 * submit again with a new invite.
 *
 * CPF, address, phone and e-mails are personal data (RNF-13/14): this service has no Logger,
 * error messages never carry values, and audit events only get the allow-listed fields
 * (see member-audit.ts).
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly clock: Clock,
    private readonly departments: DepartmentsService,
  ) {}

  /**
   * Creates (or recreates) the pending registration of a person from an invite.
   * Runs entirely inside the transaction `manager` of the caller, so Person, profile and
   * invite.usedAt commit together. Returns the audit event for the caller to emit AFTER
   * the commit; this method emits nothing.
   *
   * RA rules (RN-09):
   *  - RA of a person with role -> 409 RA_ALREADY_IN_USE;
   *  - RA with a pending or approved registration -> 409 RA_ALREADY_IN_USE (a pending
   *    registration is never overwritten, the code does not reveal the situation);
   *  - RA with a rejected registration -> resubmission: same Person and profile, pending again;
   *  - RA of a person with neither role nor profile -> the Person is reused.
   * The personal e-mail of another person -> 409 EMAIL_ALREADY_IN_USE.
   * Unknown departmentId -> 400 DEPARTMENT_NOT_FOUND.
   */
  async submitFromInvite(
    manager: EntityManager,
    input: SubmitMemberRegistrationInput,
  ): Promise<MemberRegistrationSubmission> {
    // Lock order everywhere: Person first, then MemberProfile.
    const existing = await manager.findOne(Person, {
      where: { ra: input.ra },
      lock: { mode: "pessimistic_write" },
    });
    if (existing !== null && existing.role !== null) {
      throw raAlreadyInUse();
    }

    let profile =
      existing === null
        ? null
        : await manager.findOne(MemberProfile, {
            where: { personId: existing.id },
            lock: { mode: "pessimistic_write" },
          });
    if (profile !== null && profile.registrationStatus !== MemberRegistrationStatus.REJECTED) {
      throw raAlreadyInUse();
    }
    const resubmitted = profile !== null;

    const emailOwner = await manager.findOne(Person, { where: { email: input.personalEmail } });
    if (emailOwner !== null && emailOwner.id !== existing?.id) {
      throw emailAlreadyInUse();
    }

    const departmentId = input.departmentId ?? null;
    if (departmentId !== null && !(await this.departments.exists(manager, departmentId))) {
      throw departmentNotFound();
    }

    const person = existing ?? manager.create(Person, {});
    person.name = input.name;
    person.ra = input.ra;
    person.email = input.personalEmail;
    person.birthDate = input.birthDate;
    person.phone = input.phone;
    person.passwordHash = input.passwordHash;
    // No access until coordination approves: the requested role waits in the profile.
    person.role = null;
    person.accessEnabled = false;

    try {
      const savedPerson = await manager.save(Person, person);

      profile ??= manager.create(MemberProfile, { personId: savedPerson.id });
      profile.registrationStatus = MemberRegistrationStatus.PENDING;
      profile.requestedRole = input.requestedRole;
      profile.cpf = input.cpf;
      profile.address = input.address ?? null;
      profile.city = input.city ?? null;
      profile.state = input.state ?? null;
      profile.institutionalEmail = input.institutionalEmail;
      profile.course = input.course;
      profile.semester = input.semester;
      profile.className = input.className;
      profile.departmentId = departmentId;
      profile.volunteerTermUrl = input.volunteerTermUrl ?? null;
      profile.mainFunction = null;
      profile.joinedAt = null;
      profile.submittedAt = this.clock.now();
      profile.reviewedAt = null;
      profile.reviewedById = null;
      profile.reviewNote = null;
      await manager.save(MemberProfile, profile);

      const auditEvent = buildMemberEvent(
        AuditableAction.MEMBER_REGISTRATION_SUBMITTED,
        // The acceptor IS the person being registered (the accept is anonymous).
        savedPerson.id,
        savedPerson.id,
        resubmitted ? { registrationStatus: MemberRegistrationStatus.REJECTED } : null,
        {
          registrationStatus: MemberRegistrationStatus.PENDING,
          requestedRole: input.requestedRole,
          departmentId,
          inviteId: input.inviteId,
          resubmitted,
        },
        this.clock.now(),
      );

      return { personId: savedPerson.id, auditEvent };
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
  }

  /**
   * Situation of the registration and department scope of a person, in one query.
   * Used by the AuthGuard (every request) and by the login. Domain services use it to load
   * the departments of the TARGET before PermissionPolicy.assertCan.
   */
  async findAccessFacts(personId: string): Promise<MemberAccessFacts> {
    const profile = await this.dataSource.getRepository(MemberProfile).findOne({
      where: { personId },
      select: { registrationStatus: true, departmentId: true },
    });

    if (profile === null) {
      return { registrationStatus: null, departmentIds: [] };
    }

    return {
      registrationStatus: profile.registrationStatus,
      departmentIds:
        profile.registrationStatus === MemberRegistrationStatus.APPROVED && profile.departmentId
          ? [profile.departmentId]
          : [],
    };
  }

  /**
   * The validation queue: registrations of one status (pending by default), the oldest
   * submission first, then by name. Searches by name or RA. No CPF, address, phone nor e-mails.
   */
  async listRegistrations(
    query: ListMemberRegistrationsQueryDto,
  ): Promise<PaginatedResult<MemberRegistrationListItemDto>> {
    const { page, limit } = normalizePagination(query);
    const status = query.status ?? MemberRegistrationStatus.PENDING;

    const builder = this.dataSource
      .getRepository(MemberProfile)
      .createQueryBuilder("profile")
      .innerJoin(Person, "person", "person.id = profile.person_id")
      .where("profile.registration_status = :status", { status })
      .orderBy("profile.submitted_at", "ASC", "NULLS LAST")
      .addOrderBy("person.name", "ASC");

    if (query.search?.trim()) {
      builder.andWhere("(LOWER(person.name) LIKE :term OR LOWER(person.ra) LIKE :term)", {
        term: likeTerm(query.search),
      });
    }

    // offset/limit, not skip/take: the join is 1:1 (no duplicate rows), and skip/take with a join
    // makes TypeORM wrap a DISTINCT subquery that breaks ORDER BY on the joined alias.
    const [profiles, total] = await builder
      .offset((page - 1) * limit)
      .limit(limit)
      .getManyAndCount();

    if (profiles.length === 0) {
      return { data: [], total, page, limit };
    }

    const people = await this.dataSource
      .getRepository(Person)
      .find({ where: { id: In(profiles.map((profile) => profile.personId)) } });
    const peopleById = new Map(people.map((person) => [person.id, person]));

    const departmentIds = [
      ...new Set(
        profiles.flatMap((profile) => (profile.departmentId ? [profile.departmentId] : [])),
      ),
    ];
    const departments =
      departmentIds.length === 0
        ? []
        : await this.dataSource
            .getRepository(Department)
            .find({ where: { id: In(departmentIds) } });
    const departmentsById = new Map(departments.map((department) => [department.id, department]));

    const data = profiles.flatMap((profile) => {
      const person = peopleById.get(profile.personId);
      if (person === undefined) return [];
      return [
        toMemberRegistrationListItem(
          person,
          profile,
          profile.departmentId ? (departmentsById.get(profile.departmentId) ?? null) : null,
        ),
      ];
    });

    return { data, total, page, limit };
  }

  /** The registration in full, CPF included (coordination only). 404 without member profile. */
  async getRegistration(personId: string): Promise<MemberRegistrationResponseDto> {
    const profile = await this.dataSource
      .getRepository(MemberProfile)
      .findOne({ where: { personId } });
    const person = profile
      ? await this.dataSource.getRepository(Person).findOne({ where: { id: personId } })
      : null;

    if (profile === null || person === null) {
      throw memberRegistrationNotFound();
    }

    const department = profile.departmentId
      ? await this.dataSource.getRepository(Department).findOne({
          where: { id: profile.departmentId },
        })
      : null;

    return toMemberRegistrationResponse(person, profile, department);
  }

  /**
   * Approves a pending registration (RN-08): coordination sets role, department, main
   * function and join date, and the access is granted (role set, accessEnabled true).
   *
   *  - SUPERADMIN -> 400 INVALID_ROLE, before any transaction;
   *  - no member profile -> 404; not pending -> 409 REGISTRATION_NOT_PENDING;
   *  - unknown department -> 400 DEPARTMENT_NOT_FOUND.
   * Emits MEMBER_REGISTRATION_APPROVED after the commit.
   */
  async approve(
    personId: string,
    dto: ApproveMemberRegistrationDto,
    actorId: string,
  ): Promise<MemberRegistrationResponseDto> {
    if (dto.role === Role.SUPERADMIN) {
      throw new HttpException(
        { error: "INVALID_ROLE", message: "Role cannot be assigned via API." },
        400,
      );
    }

    const approved = await this.dataSource.transaction(async (manager) => {
      const { person, profile } = await this.loadPending(manager, personId);

      const department = dto.departmentId
        ? await manager.findOne(Department, { where: { id: dto.departmentId } })
        : null;
      if (dto.departmentId && department === null) {
        throw departmentNotFound();
      }

      const before = {
        registrationStatus: MemberRegistrationStatus.PENDING,
        role: null,
        accessEnabled: false,
        departmentId: profile.departmentId,
      };

      profile.registrationStatus = MemberRegistrationStatus.APPROVED;
      profile.departmentId = department?.id ?? null;
      profile.mainFunction = dto.mainFunction;
      profile.joinedAt = dto.joinedAt;
      profile.reviewedAt = this.clock.now();
      profile.reviewedById = actorId;
      profile.reviewNote = dto.note ?? null;
      person.role = dto.role;
      person.accessEnabled = true;

      const savedProfile = await manager.save(MemberProfile, profile);
      const savedPerson = await manager.save(Person, person);

      return { person: savedPerson, profile: savedProfile, department, before };
    });

    this.emit(
      buildMemberEvent(
        AuditableAction.MEMBER_REGISTRATION_APPROVED,
        actorId,
        personId,
        approved.before,
        {
          registrationStatus: MemberRegistrationStatus.APPROVED,
          role: dto.role,
          accessEnabled: true,
          departmentId: approved.profile.departmentId,
          mainFunction: approved.profile.mainFunction,
          joinedAt: approved.profile.joinedAt,
          reviewNote: approved.profile.reviewNote,
        },
        this.clock.now(),
      ),
    );

    return toMemberRegistrationResponse(approved.person, approved.profile, approved.department);
  }

  /**
   * Rejects a pending registration with a mandatory note. The person keeps role null and
   * access disabled, and may submit again with a new invite.
   * Emits MEMBER_REGISTRATION_REJECTED after the commit.
   */
  async reject(
    personId: string,
    dto: RejectMemberRegistrationDto,
    actorId: string,
  ): Promise<MemberRegistrationResponseDto> {
    const rejected = await this.dataSource.transaction(async (manager) => {
      const { person, profile } = await this.loadPending(manager, personId);

      profile.registrationStatus = MemberRegistrationStatus.REJECTED;
      profile.reviewNote = dto.note;
      profile.reviewedAt = this.clock.now();
      profile.reviewedById = actorId;
      const savedProfile = await manager.save(MemberProfile, profile);

      const department = savedProfile.departmentId
        ? await manager.findOne(Department, { where: { id: savedProfile.departmentId } })
        : null;

      return { person, profile: savedProfile, department };
    });

    this.emit(
      buildMemberEvent(
        AuditableAction.MEMBER_REGISTRATION_REJECTED,
        actorId,
        personId,
        { registrationStatus: MemberRegistrationStatus.PENDING },
        {
          registrationStatus: MemberRegistrationStatus.REJECTED,
          reviewNote: rejected.profile.reviewNote,
        },
        this.clock.now(),
      ),
    );

    return toMemberRegistrationResponse(rejected.person, rejected.profile, rejected.department);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Loads Person and MemberProfile of an id inside a transaction, locking both rows (Person
   * first, the same order as submitFromInvite) so approvals, rejections and a resubmission of
   * the same person run one at a time.
   * 404 covers unknown ids and people without a member profile; 409 REGISTRATION_NOT_PENDING
   * covers approving or rejecting twice.
   */
  private async loadPending(
    manager: EntityManager,
    personId: string,
  ): Promise<{ person: Person; profile: MemberProfile }> {
    const person = await manager.findOne(Person, {
      where: { id: personId },
      lock: { mode: "pessimistic_write" },
    });
    const profile = person
      ? await manager.findOne(MemberProfile, {
          where: { personId },
          lock: { mode: "pessimistic_write" },
        })
      : null;

    if (person === null || profile === null) {
      throw memberRegistrationNotFound();
    }

    if (profile.registrationStatus !== MemberRegistrationStatus.PENDING) {
      throw new HttpException(
        {
          error: "REGISTRATION_NOT_PENDING",
          message: "Only pending registrations can be approved or rejected.",
        },
        409,
      );
    }

    return { person, profile };
  }

  /**
   * Turns the unique violations of the sign-up into 409, by constraint name (the `detail` of
   * Postgres carries the duplicated value and must never be logged). Any other error is kept.
   */
  private mapUniqueViolation(error: unknown): unknown {
    if (error instanceof QueryFailedError) {
      const driverError = error.driverError as { code?: string; constraint?: string } | undefined;
      if (driverError?.code === "23505") {
        if (driverError.constraint === "uq_people_email") return emailAlreadyInUse();
        if (
          driverError.constraint === "uq_people_ra" ||
          driverError.constraint === "uq_member_profiles_person_id"
        ) {
          return raAlreadyInUse();
        }
      }
    }
    return error;
  }

  /** Emits on the audit channel. Called only after the transaction has committed. */
  private emit(event: AuditableActionEvent): void {
    this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, event);
  }
}
