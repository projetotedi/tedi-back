import { HttpException, Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { isUUID } from "class-validator";
import { DataSource, EntityManager, In, QueryFailedError, SelectQueryBuilder } from "typeorm";
import { Clock } from "@shared/dates/clock";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { Role } from "@shared/enums/role.enum";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { normalizePagination, PaginatedResult } from "@shared/pagination/pagination.util";
import { Permission } from "@shared/permissions/permission.enum";
import { OwnAccountException } from "@shared/permissions/permission.errors";
import { PermissionPolicy } from "@shared/permissions/permission.policy";
import { applyTextSearch } from "@shared/search/search.util";
import { ApproveMemberRegistrationDto } from "../dto/approve-member-registration.dto";
import { DeactivateMemberDto } from "../dto/deactivate-member.dto";
import { ListMemberRegistrationsQueryDto } from "../dto/list-member-registrations-query.dto";
import { MemberDetailResponseDto } from "../dto/member-detail.response.dto";
import { MemberRegistrationFormDto } from "../dto/member-registration-form.dto";
import { MemberRegistrationListItemDto } from "../dto/member-registration-list-item.dto";
import { MemberRegistrationResponseDto } from "../dto/member-registration.response.dto";
import { ListMembersQueryDto } from "../dto/list-members-query.dto";
import { MemberListItemResponseDto } from "../dto/member-list-item.response.dto";
import { RejectMemberRegistrationDto } from "../dto/reject-member-registration.dto";
import { Department } from "../entities/department.entity";
import { MemberProfile } from "../entities/member-profile.entity";
import { Person } from "../entities/person.entity";
import { MemberRegistrationStatus } from "../enums/member-registration-status.enum";
import { MemberStatus } from "../enums/member-status.enum";
import { DepartmentsService } from "./departments.service";
import { buildMemberEvent } from "./member-audit";
import { toMemberDetail } from "./member-detail.mapper";
import {
  toMemberRegistrationListItem,
  toMemberRegistrationResponse,
} from "./member-registration.mapper";
import { PeopleService } from "./people.service";

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
 * What another module needs to know about a member to give her work (the assignments of the
 * lessons, GUS-158): who she is, whether she can receive it today and her department. The shape is
 * the contract of `getMemberSummary`: the Person and the member profile never leave this module.
 *  - active: she has an access role, her access is enabled and, if she has a member profile, it is
 *    approved and active (`isActiveMember`). A pending or rejected registration is a member, but
 *    not active; neither is an inactivated member (GUS-147).
 *  - departmentIds: the department of the APPROVED profile, or [] (the same rule as
 *    `findAccessFacts`): what the `department` scope of the member record is checked against.
 */
export interface MemberSummary {
  id: string;
  name: string;
  active: boolean;
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

interface MemberListRawRow {
  id: string;
  name: string;
  ra: string | null;
  role: Role | null;
  accessEnabled: boolean;
  departmentId: string | null;
  departmentName: string | null;
  mainFunction: string | null;
  joinedAt: string | null;
  registrationStatus: MemberRegistrationStatus | null;
  status: MemberStatus;
  exitDate: string | null;
  exitReason: string | null;
}

/**
 * Situation of a row of GET /members: the participation of the member profile, and `active` for a
 * person without one, who was never deactivated. It interpolates a constant of the code, never
 * input.
 */
const MEMBER_STATUS_SQL = `COALESCE(member_profile.status, '${MemberStatus.ACTIVE}')`;

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

/**
 * The one place that builds the "member not found" error of the member record (GUS-144): an
 * unknown id, a malformed id, a deleted person and a person with neither an access role nor a
 * member profile all answer the same 404 MEMBER_NOT_FOUND. Used by this service and by the id
 * pipe of the controller.
 */
export function memberNotFound(): HttpException {
  return new HttpException({ error: "MEMBER_NOT_FOUND", message: "Member not found." }, 404);
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

/**
 * The one place that builds the 409 MEMBER_INACTIVE: a write that needs an active member answers
 * it for an inactive one (a second deactivation here, the edit of the member record later).
 */
export function memberInactive(): HttpException {
  return new HttpException({ error: "MEMBER_INACTIVE", message: "The member is inactive." }, 409);
}

/** 409 NO_MEMBER_PROFILE: a person with an access role and no member profile is not deactivated. */
function noMemberProfile(): HttpException {
  return new HttpException(
    { error: "NO_MEMBER_PROFILE", message: "This person has no member profile." },
    409,
  );
}

/** 409 REGISTRATION_NOT_APPROVED: a pending or rejected registration is not a member that leaves. */
function registrationNotApproved(): HttpException {
  return new HttpException(
    {
      error: "REGISTRATION_NOT_APPROVED",
      message: "Only members with an approved registration can be deactivated.",
    },
    409,
  );
}

/** 400 EXIT_DATE_BEFORE_JOINED_AT, with the field in `details` so the front anchors it on exitDate. */
function exitDateBeforeJoinedAt(): HttpException {
  return new HttpException(
    {
      error: "EXIT_DATE_BEFORE_JOINED_AT",
      message: "exitDate must be on or after the join date.",
      details: [{ field: "exitDate", message: "exitDate must be on or after the join date" }],
    },
    400,
  );
}

/**
 * Department scope that a member profile gives to its person: the department of an APPROVED
 * profile, or nothing. The department suggested at sign-up (pending) and the one kept after a
 * rejection never give scope (ARCHITECTURE section 9.1).
 *
 * The one rule behind both sides of the `department` scope: the scope of the ACTOR (the
 * AuthGuard reads it through findAccessFacts on every request, decision 19) and the scope of the
 * TARGET of the member record (getMember).
 */
function departmentScopeOf(
  profile: Pick<MemberProfile, "registrationStatus" | "departmentId"> | null,
): string[] {
  return profile !== null &&
    profile.registrationStatus === MemberRegistrationStatus.APPROVED &&
    profile.departmentId
    ? [profile.departmentId]
    : [];
}

/**
 * Whether a member can be given work today: she has an access role, her access is enabled and, if
 * she has a member profile, it is approved and the member has not left the project (GUS-147). A
 * person without a profile (the seeded admin, the coordinators, the accounts that predate GUS-91)
 * is not subject to the validation.
 *
 * It is the ONE place that says "active member": whoever asks `getMemberSummary` follows it. The
 * deactivation already disables the access, but PATCH /access/:id/enabled can enable it again
 * while the member is still inactive; the status keeps her inactive here.
 */
function isActiveMember(
  person: Pick<Person, "role" | "accessEnabled">,
  profile: Pick<MemberProfile, "registrationStatus" | "status"> | null,
): boolean {
  return (
    person.role !== null &&
    person.accessEnabled &&
    (profile === null ||
      (profile.registrationStatus === MemberRegistrationStatus.APPROVED &&
        profile.status === MemberStatus.ACTIVE))
  );
}

/**
 * Member registration and its validation by coordination (GUS-91, RN-08, RF-004, RF-011), the
 * member record that reads it back (GUS-144), and the deactivation and reactivation of a member
 * (GUS-147).
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
    private readonly permissions: PermissionPolicy,
    private readonly people: PeopleService,
  ) {}

  /**
   * Lists people with an access role and all people with a member profile, including pending
   * and rejected registrations whose role is null. Sensitive registration fields are not selected.
   * The `status` filter is the participation (GUS-147): omitted lists every status, and a person
   * without member profile counts as active.
   */
  async listMembers(
    query: ListMembersQueryDto,
  ): Promise<PaginatedResult<MemberListItemResponseDto>> {
    const { page, limit } = normalizePagination(query);
    const builder = this.buildMembersListQuery(query);

    const [rows, total] = await Promise.all([
      builder
        .clone()
        .offset((page - 1) * limit)
        .limit(limit)
        .getRawMany<MemberListRawRow>(),
      builder.clone().getCount(),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        ra: row.ra,
        role: row.role,
        accessEnabled: row.accessEnabled,
        department:
          row.departmentId !== null && row.departmentName !== null
            ? { id: row.departmentId, name: row.departmentName }
            : null,
        mainFunction: row.mainFunction,
        joinedAt: row.joinedAt,
        registrationStatus: row.registrationStatus,
        status: row.status,
        exitDate: row.exitDate,
        exitReason: row.exitReason,
      })),
      total,
      page,
      limit,
    };
  }

  private buildMembersListQuery(query: ListMembersQueryDto): SelectQueryBuilder<Person> {
    const builder = this.dataSource
      .getRepository(Person)
      .createQueryBuilder("person")
      .leftJoin(MemberProfile, "member_profile", "member_profile.person_id = person.id")
      .leftJoin(Department, "department", "department.id = member_profile.department_id")
      .select("person.id", "id")
      .addSelect("person.name", "name")
      .addSelect("person.ra", "ra")
      .addSelect("person.role", "role")
      .addSelect("person.access_enabled", "accessEnabled")
      .addSelect("department.id", "departmentId")
      .addSelect("department.name", "departmentName")
      .addSelect("member_profile.main_function", "mainFunction")
      .addSelect("member_profile.joined_at::text", "joinedAt")
      .addSelect("member_profile.registration_status", "registrationStatus")
      .addSelect(MEMBER_STATUS_SQL, "status")
      .addSelect("member_profile.exit_date::text", "exitDate")
      .addSelect("member_profile.exit_reason", "exitReason")
      .where("(person.role IS NOT NULL OR member_profile.id IS NOT NULL)");

    applyTextSearch(builder, ["person.name", "person.ra"], query.search);
    this.applyMembersListFilters(builder, query);
    return builder.orderBy("person.name", "ASC").addOrderBy("person.id", "ASC");
  }

  private applyMembersListFilters(
    builder: SelectQueryBuilder<Person>,
    query: ListMembersQueryDto,
  ): void {
    if (query.role !== undefined) {
      builder.andWhere("person.role = :role", { role: query.role });
    }
    if (query.departmentId !== undefined) {
      builder.andWhere("member_profile.department_id = :departmentId", {
        departmentId: query.departmentId,
      });
    }
    if (query.registrationStatus !== undefined) {
      builder.andWhere("member_profile.registration_status = :registrationStatus", {
        registrationStatus: query.registrationStatus,
      });
    }
    if (query.enabled !== undefined) {
      builder.andWhere("person.access_enabled = :enabled", { enabled: query.enabled });
    }
    if (query.status !== undefined) {
      builder.andWhere(`${MEMBER_STATUS_SQL} = :status`, { status: query.status });
    }
  }

  /**
   * The member record (GUS-144): the Person joined with her member profile, the department of
   * that profile and who reviewed the registration. Allocations, attendance and the hours bank
   * are not here.
   *
   * 404 MEMBER_NOT_FOUND for an id that is not a uuid, an unknown or deleted person, and a person
   * with neither an access role nor a member profile. That is the predicate of `listMembers`, so
   * every row of the list opens its record: pending and rejected registrations, and the seeded
   * admin and the coordinators without a profile (member fields null, registrationStatus null).
   * The 404 comes BEFORE the scope check.
   *
   * Scope (`members.view`): coordination reads anyone; a director only a member of the own
   * department, otherwise 403 FORBIDDEN_SCOPE. The department of the TARGET is the one of the
   * APPROVED profile (departmentScopeOf, the same rule as findAccessFacts), so a pending or
   * rejected registration, a person without a profile and a target without department are
   * outside the scope of every director.
   *
   * The CPF only leaves masked (RNF-14). Personal data: this service has no Logger and the errors
   * carry no value.
   */
  async getMember(id: string, actor: AuthUser): Promise<MemberDetailResponseDto> {
    // The service is exported: an id that is not a uuid must not reach Postgres (22P02 -> 500).
    if (!isUUID(id)) throw memberNotFound();

    const person = await this.dataSource.getRepository(Person).findOne({ where: { id } });
    const profile =
      person === null
        ? null
        : await this.dataSource.getRepository(MemberProfile).findOne({ where: { personId: id } });
    if (person === null || (person.role === null && profile === null)) {
      throw memberNotFound();
    }

    this.permissions.assertCan(actor, Permission.MEMBERS_VIEW, {
      personId: id,
      departmentIds: departmentScopeOf(profile),
    });

    return this.toMemberRecord(person, profile);
  }

  /**
   * Ends the participation of a member (RF-011, GUS-147): status inactive, exit date, reason and
   * note, who and when, and Person.accessEnabled false, in ONE transaction. Emits
   * MEMBER_DEACTIVATED after the commit, without the note. Allocations (E5) are not touched yet.
   *
   * Order: 404 MEMBER_NOT_FOUND for a malformed id (the service is exported: a value that is not a
   * uuid must not reach Postgres, 22P02 -> 500) and 403 OWN_ACCOUNT, both before the transaction as
   * in /access; then, inside it, 404 MEMBER_NOT_FOUND, 409 NO_MEMBER_PROFILE, 409
   * REGISTRATION_NOT_APPROVED, 409 MEMBER_INACTIVE (a second exit would silently overwrite the
   * first one), 400 EXIT_DATE_BEFORE_JOINED_AT and 409 LAST_COORDINATOR.
   *
   * The id is used in lower case, the canonical text of a uuid and the form actor.id comes from
   * Postgres: the id pipe accepts upper case and Postgres compares uuid ignoring case, so with the
   * raw path id an actor could pass OWN_ACCOUNT by sending her own id in upper case.
   *
   * The exit may be on the join date ("YYYY-MM-DD" compares chronologically as text); a profile
   * approved by the backfill has no join date, so only the floor of the DTO applies.
   * LAST_COORDINATOR is the rule of /access with the same superadmin bypass (decision 10 of E9.a,
   * GUS-81), but it only runs when the target coordinator still has the access enabled: a target
   * that is already disabled is not in the count, so deactivating her does not change the set of
   * active coordinators, and checking would refuse the legitimate "disable the access, then
   * register the exit" flow. With a coordinator as the actor (active, and never the target) the
   * count is then always 2 or more, so the 409 does not show up in sequence; the check stays as
   * the read that lets SERIALIZABLE catch two coordinators removing each other at the same time.
   *
   * SERIALIZABLE, like PATCH /access/:id/role and /enabled: LAST_COORDINATOR counts the active
   * coordinators, and two coordinators removing each other at the same time (one here, one in
   * /access) is a write skew that only Postgres SSI catches, and only when both sides are
   * SERIALIZABLE. The price is the one /access already pays: an overlapping duplicate request may
   * answer 500 (40001) instead of 409.
   */
  async deactivateMember(
    id: string,
    dto: DeactivateMemberDto,
    actor: AuthUser,
  ): Promise<MemberDetailResponseDto> {
    if (!isUUID(id)) throw memberNotFound();
    const personId = id.toLowerCase();
    if (actor.id === personId) throw new OwnAccountException();

    const result = await this.dataSource.transaction("SERIALIZABLE", async (manager) => {
      const { person, profile } = await this.loadMemberForUpdate(manager, personId);
      if (profile === null) throw noMemberProfile();
      if (profile.registrationStatus !== MemberRegistrationStatus.APPROVED) {
        throw registrationNotApproved();
      }
      if (profile.status === MemberStatus.INACTIVE) throw memberInactive();
      if (profile.joinedAt !== null && dto.exitDate < profile.joinedAt) {
        throw exitDateBeforeJoinedAt();
      }
      if (
        person.role === Role.COORDINATOR &&
        person.accessEnabled &&
        actor.role !== Role.SUPERADMIN
      ) {
        await this.people.assertNotLastActiveCoordinator(manager);
      }

      const before = { status: profile.status, accessEnabled: person.accessEnabled };
      profile.status = MemberStatus.INACTIVE;
      profile.exitDate = dto.exitDate;
      profile.exitReason = dto.reason;
      profile.exitNote = dto.note ?? null;
      profile.deactivatedAt = this.clock.now();
      profile.deactivatedById = actor.id;
      person.accessEnabled = false;

      const savedProfile = await manager.save(MemberProfile, profile);
      const savedPerson = await manager.save(Person, person);
      return { person: savedPerson, profile: savedProfile, before };
    });

    this.emit(
      buildMemberEvent(
        AuditableAction.MEMBER_DEACTIVATED,
        actor.id,
        personId,
        result.before,
        {
          status: MemberStatus.INACTIVE,
          accessEnabled: false,
          exitDate: result.profile.exitDate,
          exitReason: result.profile.exitReason,
        },
        this.clock.now(),
      ),
    );

    return this.toMemberRecord(result.person, result.profile);
  }

  /**
   * The member is active again and the exit is cleared (GUS-147). The access is NOT enabled: that
   * stays with PATCH /access/:id/enabled. An active member, a pending or rejected registration and
   * a person without member profile answer unchanged (200, no write, no event: section 10.3 of
   * ARCHITECTURE). The old exit only survives in the MEMBER_DEACTIVATED event. Same 404, same 403
   * OWN_ACCOUNT and same lower-case id as deactivateMember. Default isolation: nothing here
   * reduces the coordinators nor touches the access, and the row locks serialize two reactivations
   * of the same member.
   *
   * `reactivated` carries the `before` only when something changed, so an event can never go out
   * with an empty `before`, and there are no two flags that could disagree.
   */
  async reactivateMember(id: string, actor: AuthUser): Promise<MemberDetailResponseDto> {
    if (!isUUID(id)) throw memberNotFound();
    const personId = id.toLowerCase();
    if (actor.id === personId) throw new OwnAccountException();

    const result = await this.dataSource.transaction(async (manager) => {
      const { person, profile } = await this.loadMemberForUpdate(manager, personId);
      if (profile === null || profile.status === MemberStatus.ACTIVE) {
        return { person, profile, reactivated: null };
      }

      const before = {
        status: profile.status,
        exitDate: profile.exitDate,
        exitReason: profile.exitReason,
      };
      profile.status = MemberStatus.ACTIVE;
      profile.exitDate = null;
      profile.exitReason = null;
      profile.exitNote = null;
      profile.deactivatedAt = null;
      profile.deactivatedById = null;

      const savedProfile = await manager.save(MemberProfile, profile);
      return { person, profile: savedProfile, reactivated: { before } };
    });

    if (result.reactivated !== null) {
      this.emit(
        buildMemberEvent(
          AuditableAction.MEMBER_REACTIVATED,
          actor.id,
          personId,
          result.reactivated.before,
          { status: MemberStatus.ACTIVE, exitDate: null, exitReason: null },
          this.clock.now(),
        ),
      );
    }

    return this.toMemberRecord(result.person, result.profile);
  }

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
   * Summary of a member for another module (the assignments of the lessons, GUS-158). Null when the
   * id is not a uuid, when there is no such person and when she is neither a member with an access
   * role nor has a member profile: the predicate of `getMember`, so a student is not a member. A
   * pending or rejected registration IS returned, with `active` false, so the caller can say
   * "inactive" apart from "not a member". Whoever calls decides the error.
   *
   * Pass the `manager` of a transaction to read inside it. `forShare` locks the row of the person
   * FOR SHARE until the end of that transaction (it needs the `manager` of one: Postgres only keeps
   * a row lock inside a transaction). That lock conflicts with the FOR UPDATE that the approval of
   * the registration and the change of access take on the person, so assigning a member and
   * disabling her at the same time are serialized: either the assignment sees her inactive, or the
   * change waits for it. Shared locks do not conflict with each other, so two assignments of the
   * same member do not wait for one another. Without `forShare` it is a plain read.
   *
   * It writes nothing and emits no event. Personal data: only the id, the name, the flag and the
   * department leave.
   */
  async getMemberSummary(
    id: string,
    manager?: EntityManager,
    options: { forShare?: boolean } = {},
  ): Promise<MemberSummary | null> {
    // The service is exported: an id that is not a uuid must not reach Postgres (22P02 -> 500).
    if (!isUUID(id)) return null;

    const source = manager ?? this.dataSource.manager;
    const person = await source.findOne(Person, {
      where: { id },
      ...(options.forShare ? { lock: { mode: "pessimistic_read" as const } } : {}),
    });
    if (person === null) return null;

    // After the lock of the person: the approval and the rejection take the person first, so the
    // profile read here is never one that is changing under it.
    const profile = await source.findOne(MemberProfile, { where: { personId: person.id } });
    if (person.role === null && profile === null) return null;

    return {
      id: person.id,
      name: person.name,
      active: isActiveMember(person, profile),
      departmentIds: departmentScopeOf(profile),
    };
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

    return {
      registrationStatus: profile?.registrationStatus ?? null,
      departmentIds: departmentScopeOf(profile),
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

    applyTextSearch(builder, ["person.name", "person.ra"], query.search);

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
   * Person and member profile of a member-record id inside a transaction, both rows locked,
   * Person first (the order of submitFromInvite and loadPending). 404 MEMBER_NOT_FOUND with the
   * predicate of getMember: an unknown or deleted person, or one with no role and no profile.
   * `profile` is null for a person with a role and no member profile. Two reads and no relation:
   * FOR UPDATE cannot lock the nullable side of an outer join.
   */
  private async loadMemberForUpdate(
    manager: EntityManager,
    id: string,
  ): Promise<{ person: Person; profile: MemberProfile | null }> {
    const person = await manager.findOne(Person, {
      where: { id },
      lock: { mode: "pessimistic_write" },
    });
    const profile =
      person === null
        ? null
        : await manager.findOne(MemberProfile, {
            where: { personId: id },
            lock: { mode: "pessimistic_write" },
          });
    if (person === null || (person.role === null && profile === null)) {
      throw memberNotFound();
    }
    return { person, profile };
  }

  /**
   * The member record (MemberDetailResponseDto) of a Person and her member profile, null without
   * one: reads the department of the profile and who reviewed the registration, through the
   * DataSource. Shared by getMember and by the writes that answer the record.
   *
   * The department shown is the one of the profile, even a pending one's suggestion (as in
   * GET /members): only the scope of getMember uses "approved". A reviewer that was deleted is
   * null.
   */
  private async toMemberRecord(
    person: Person,
    profile: MemberProfile | null,
  ): Promise<MemberDetailResponseDto> {
    const [department, reviewer] = await Promise.all([
      profile?.departmentId
        ? this.dataSource.getRepository(Department).findOne({ where: { id: profile.departmentId } })
        : null,
      profile?.reviewedById
        ? this.dataSource.getRepository(Person).findOne({ where: { id: profile.reviewedById } })
        : null,
    ]);

    return toMemberDetail(person, profile, department, reviewer);
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
