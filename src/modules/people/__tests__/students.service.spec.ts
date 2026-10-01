import "reflect-metadata";
import { HttpException, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Test } from "@nestjs/testing";
import { DataSource, FindOperator, In, QueryFailedError } from "typeorm";
import { Clock } from "@shared/dates/clock";
import { ArchivableColumns } from "@shared/entities/archivable.columns";
import { Role } from "@shared/enums/role.enum";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { Person } from "../entities/person.entity";
import { StudentProfile } from "../entities/student-profile.entity";
import { AccessibilityNeed } from "../enums/accessibility-need.enum";
import { StudentsService } from "../services/students.service";

// 22:30 BRT on 2026-10-01 is already 2026-10-02 in UTC: ages must use the São Paulo date.
const NOW = new Date("2026-10-02T01:30:00.000Z");
const CREATED_AT = new Date("2026-09-01T12:00:00.000Z");

const ACTOR_ID = "01999a3e-0000-7000-8000-0000000000aa";
const STUDENT_ID = "01999a3e-7c1b-7000-8000-000000000001";
const PROFILE_ID = "01999a3e-7c1b-7000-8000-000000000002";

// Personal data that must never reach a log or an audit event.
const SENSITIVE_VALUES = [
  "43999990000",
  "43911112222",
  "maria.santos@example.com",
  "novo@example.com",
  "Ana Santos",
  "43988887777",
  "43977776666",
  "Fonte ampliada",
  "Sentar perto do projetor",
  "Legenda nos videos",
  "visual",
  "hearing",
];

function buildPerson(overrides: Partial<Person> = {}): Person {
  return Object.assign(new Person(), {
    id: STUDENT_ID,
    name: "Maria Silva Santos",
    email: "maria.santos@example.com",
    ra: null,
    passwordHash: null,
    role: null,
    accessEnabled: true,
    birthDate: "1958-04-12",
    phone: "43999990000",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    ...overrides,
  });
}

function buildProfile(
  overrides: Partial<Omit<StudentProfile, "archive">> & {
    archive?: Partial<ArchivableColumns>;
  } = {},
): StudentProfile {
  const { archive, ...rest } = overrides;
  return Object.assign(new StudentProfile(), {
    id: PROFILE_ID,
    personId: STUDENT_ID,
    education: "Ensino fundamental completo",
    hasSmartphone: true,
    hasComputer: false,
    howFoundUs: "Indicação de uma amiga",
    emergencyContactName: "Ana Santos",
    emergencyContactPhone: "43988887777",
    accessibilityNeed: AccessibilityNeed.VISUAL,
    supportResource: "Fonte ampliada",
    classNeeds: "Sentar perto do projetor",
    createdById: ACTOR_ID,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    archive: Object.assign(new ArchivableColumns(), {
      archivedAt: null,
      archivedById: null,
      archiveReason: null,
      ...archive,
    }),
    ...rest,
  });
}

function uniqueViolation(constraint: string): QueryFailedError {
  const driverError = Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint,
  });
  return new QueryFailedError("INSERT INTO people", [], driverError);
}

async function httpFailure(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return error as HttpException;
  }
  throw new Error("Expected the promise to reject with an HttpException");
}

describe("StudentsService", () => {
  let service: StudentsService;
  let order: string[];
  let state: { person: Person | null; profile: StudentProfile | null };

  const manager = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
  };
  const personRepository = { find: jest.fn() };
  const profileRepository = { find: jest.fn(), findOne: jest.fn() };
  const dataSource = {
    transaction: jest.fn(),
    getRepository: jest.fn(),
  };
  const eventEmitter = { emit: jest.fn() };

  function emittedEvents(): AuditableActionEvent[] {
    return eventEmitter.emit.mock.calls.map((call) => call[1] as AuditableActionEvent);
  }

  function expectNoSensitiveValue(text: string): void {
    for (const value of SENSITIVE_VALUES) {
      expect(text).not.toContain(value);
    }
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    order = [];
    state = { person: buildPerson(), profile: buildProfile() };

    manager.create.mockImplementation((target: unknown, data: Record<string, unknown>) => {
      if (target === Person) {
        return Object.assign(new Person(), {
          id: STUDENT_ID,
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
          deletedAt: null,
          ...data,
        });
      }
      return Object.assign(new StudentProfile(), {
        id: PROFILE_ID,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        deletedAt: null,
        ...data,
      });
    });
    manager.save.mockImplementation(async (entity: unknown) => entity);
    manager.findOne.mockImplementation(async (target: unknown) =>
      target === StudentProfile ? state.profile : target === Person ? state.person : null,
    );
    dataSource.transaction.mockImplementation(
      async (callback: (m: unknown) => Promise<unknown>) => {
        const result = await callback(manager);
        order.push("commit");
        return result;
      },
    );
    dataSource.getRepository.mockImplementation((target: unknown) =>
      target === StudentProfile ? profileRepository : personRepository,
    );
    eventEmitter.emit.mockImplementation(() => {
      order.push("emit");
      return true;
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        StudentsService,
        { provide: DataSource, useValue: dataSource },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: Clock, useValue: { now: () => NOW } },
      ],
    }).compile();

    service = moduleRef.get(StudentsService);
  });

  describe("create()", () => {
    const dto = {
      name: "Maria Silva Santos",
      birthDate: "1958-04-12",
      email: "maria.santos@example.com",
      phone: "43999990000",
      education: "Ensino fundamental completo",
      hasSmartphone: true,
      hasComputer: false,
      howFoundUs: "Indicação de uma amiga",
      emergencyContactName: "Ana Santos",
      emergencyContactPhone: "43988887777",
      accessibilityNeed: AccessibilityNeed.VISUAL,
      supportResource: "Fonte ampliada",
      classNeeds: "Sentar perto do projetor",
    };

    it("creates the person and the profile in one transaction with createdById = actor", async () => {
      const result = await service.create(dto, ACTOR_ID);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.create).toHaveBeenNthCalledWith(1, Person, {
        name: "Maria Silva Santos",
        birthDate: "1958-04-12",
        email: "maria.santos@example.com",
        phone: "43999990000",
      });
      expect(manager.create).toHaveBeenNthCalledWith(
        2,
        StudentProfile,
        expect.objectContaining({
          personId: STUDENT_ID,
          createdById: ACTOR_ID,
          education: "Ensino fundamental completo",
          hasSmartphone: true,
          hasComputer: false,
          emergencyContactName: "Ana Santos",
          emergencyContactPhone: "43988887777",
          accessibilityNeed: AccessibilityNeed.VISUAL,
        }),
      );
      expect(manager.save).toHaveBeenCalledTimes(2);

      expect(result.id).toBe(STUDENT_ID);
      expect(result.createdById).toBe(ACTOR_ID);
      expect(result.archivedAt).toBeNull();
      // Explicit projection: nothing outside StudentResponseDto leaks.
      expect(result).not.toHaveProperty("passwordHash");
      expect(result).not.toHaveProperty("personId");
    });

    it("returns age computed with the injected clock in America/Sao_Paulo", async () => {
      const result = await service.create(dto, ACTOR_ID);
      expect(result.age).toBe(68);

      // Born on 1958-10-02: still 67 on the São Paulo date (2026-10-01), 68 only on the UTC date.
      const border = await service.create({ ...dto, birthDate: "1958-10-02" }, ACTOR_ID);
      expect(border.age).toBe(67);
    });

    it("defaults accessibilityNeed to none", async () => {
      const result = await service.create(
        { name: "João Souza", birthDate: "1950-01-31" },
        ACTOR_ID,
      );

      expect(manager.create).toHaveBeenNthCalledWith(
        2,
        StudentProfile,
        expect.objectContaining({
          accessibilityNeed: AccessibilityNeed.NONE,
          education: null,
          hasSmartphone: null,
          emergencyContactPhone: null,
        }),
      );
      expect(result.accessibilityNeed).toBe(AccessibilityNeed.NONE);
      expect(result.email).toBeNull();
      expect(result.phone).toBeNull();
    });

    it("maps the uq_people_email violation to 409 EMAIL_ALREADY_IN_USE", async () => {
      dataSource.transaction.mockRejectedValueOnce(uniqueViolation("uq_people_email"));

      const failure = await httpFailure(service.create(dto, ACTOR_ID));

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "EMAIL_ALREADY_IN_USE",
        message: "Email already in use.",
      });
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("emits STUDENT_CREATED after commit with only non-sensitive fields", async () => {
      await service.create(dto, ACTOR_ID);

      expect(order).toEqual(["commit", "emit"]);
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emit).toHaveBeenCalledWith(AUDITABLE_ACTION_EVENT, expect.anything());

      const [event] = emittedEvents();
      expect(event.action).toBe(AuditableAction.STUDENT_CREATED);
      expect(event.actorId).toBe(ACTOR_ID);
      expect(event.targetType).toBe("student");
      expect(event.targetId).toBe(STUDENT_ID);
      expect(event.before).toBeNull();
      expect(event.after).toEqual({
        name: "Maria Silva Santos",
        birthDate: "1958-04-12",
        education: "Ensino fundamental completo",
        hasSmartphone: true,
        hasComputer: false,
        howFoundUs: "Indicação de uma amiga",
      });
      expectNoSensitiveValue(JSON.stringify(event));
    });

    it("does not emit when the transaction fails", async () => {
      dataSource.transaction.mockRejectedValueOnce(new Error("connection lost"));

      await expect(service.create(dto, ACTOR_ID)).rejects.toThrow("connection lost");

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("rethrows other database errors unchanged", async () => {
      const error = uniqueViolation("uq_people_ra");
      dataSource.transaction.mockRejectedValueOnce(error);

      await expect(service.create(dto, ACTOR_ID)).rejects.toBe(error);
    });
  });

  describe("update()", () => {
    it("returns 404 STUDENT_NOT_FOUND when the person has no student profile", async () => {
      state.profile = null;

      const failure = await httpFailure(service.update(STUDENT_ID, { name: "Outro" }, ACTOR_ID));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "STUDENT_NOT_FOUND",
        message: "Student not found.",
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("returns 404 STUDENT_NOT_FOUND when the person was soft-deleted", async () => {
      state.person = null;

      const failure = await httpFailure(service.update(STUDENT_ID, { name: "Outro" }, ACTOR_ID));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "STUDENT_NOT_FOUND",
        message: "Student not found.",
      });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("locks the profile row for the whole edit", async () => {
      await service.update(STUDENT_ID, {}, ACTOR_ID);

      expect(manager.findOne).toHaveBeenCalledWith(StudentProfile, {
        where: { personId: STUDENT_ID },
        lock: { mode: "pessimistic_write" },
      });
    });

    it("returns 409 STUDENT_ARCHIVED when the student is archived", async () => {
      state.profile = buildProfile({ archive: { archivedAt: CREATED_AT, archivedById: ACTOR_ID } });

      const failure = await httpFailure(service.update(STUDENT_ID, { name: "Outro" }, ACTOR_ID));

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toEqual({
        error: "STUDENT_ARCHIVED",
        message: "Archived students are read-only.",
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("changes only the fields sent and clears fields sent as null", async () => {
      const result = await service.update(
        STUDENT_ID,
        { phone: "43911112222", classNeeds: null },
        ACTOR_ID,
      );

      expect(result.phone).toBe("43911112222");
      expect(result.classNeeds).toBeNull();
      // Omitted fields stay as they were.
      expect(result.name).toBe("Maria Silva Santos");
      expect(result.birthDate).toBe("1958-04-12");
      expect(result.email).toBe("maria.santos@example.com");
      expect(result.supportResource).toBe("Fonte ampliada");
      expect(result.accessibilityNeed).toBe(AccessibilityNeed.VISUAL);
      expect(result.age).toBe(68);
      expect(manager.save).toHaveBeenCalledTimes(2);
    });

    it("saves only the entity that changed", async () => {
      await service.update(STUDENT_ID, { education: "Ensino médio" }, ACTOR_ID);

      expect(manager.save).toHaveBeenCalledTimes(1);
      expect(manager.save).toHaveBeenCalledWith(expect.any(StudentProfile));
    });

    it("emits STUDENT_UPDATED with changedFields and without sensitive values", async () => {
      await service.update(
        STUDENT_ID,
        {
          name: "Maria S. Santos",
          education: "Ensino médio",
          email: "novo@example.com",
          phone: "43911112222",
          emergencyContactPhone: "43977776666",
          accessibilityNeed: AccessibilityNeed.HEARING,
          supportResource: "Legenda nos videos",
        },
        ACTOR_ID,
      );

      expect(order).toEqual(["commit", "emit"]);
      const [event] = emittedEvents();
      expect(event.action).toBe(AuditableAction.STUDENT_UPDATED);
      expect(event.targetId).toBe(STUDENT_ID);
      expect(event.before).toEqual({
        name: "Maria Silva Santos",
        education: "Ensino fundamental completo",
      });
      expect(event.after).toEqual({
        name: "Maria S. Santos",
        education: "Ensino médio",
        changedFields: [
          "name",
          "email",
          "phone",
          "education",
          "emergencyContactPhone",
          "accessibilityNeed",
          "supportResource",
        ],
      });
      expectNoSensitiveValue(JSON.stringify(event));
    });

    it("is a no-op without event when nothing changed", async () => {
      const unchanged = await service.update(
        STUDENT_ID,
        {
          name: "Maria Silva Santos",
          phone: "43999990000",
          classNeeds: "Sentar perto do projetor",
        },
        ACTOR_ID,
      );
      const empty = await service.update(STUDENT_ID, {}, ACTOR_ID);

      expect(unchanged.id).toBe(STUDENT_ID);
      expect(empty.id).toBe(STUDENT_ID);
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("maps the uq_people_email violation to 409 EMAIL_ALREADY_IN_USE", async () => {
      manager.save.mockRejectedValueOnce(uniqueViolation("uq_people_email"));

      const failure = await httpFailure(
        service.update(STUDENT_ID, { email: "novo@example.com" }, ACTOR_ID),
      );

      expect(failure.getStatus()).toBe(409);
      expect(failure.getResponse()).toMatchObject({ error: "EMAIL_ALREADY_IN_USE" });
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("archive()", () => {
    it("archives with actor, date and reason and emits STUDENT_ARCHIVED", async () => {
      const result = await service.archive(STUDENT_ID, { reason: "Mudou de cidade." }, ACTOR_ID);

      expect(result.archivedAt).toEqual(NOW);
      expect(result.archivedById).toBe(ACTOR_ID);
      expect(result.archiveReason).toBe("Mudou de cidade.");
      expect(manager.save).toHaveBeenCalledTimes(1);

      expect(order).toEqual(["commit", "emit"]);
      const [event] = emittedEvents();
      expect(event.action).toBe(AuditableAction.STUDENT_ARCHIVED);
      expect(event.actorId).toBe(ACTOR_ID);
      expect(event.targetType).toBe("student");
      expect(event.targetId).toBe(STUDENT_ID);
      expect(event.before).toEqual({ archivedAt: null });
      expect(event.after).toEqual({ archivedAt: NOW, archiveReason: "Mudou de cidade." });
      expectNoSensitiveValue(JSON.stringify(event));
    });

    it("archives without a body and records a null reason", async () => {
      const result = await service.archive(STUDENT_ID, undefined, ACTOR_ID);

      expect(result.archivedAt).toEqual(NOW);
      expect(result.archiveReason).toBeNull();
    });

    it("keeps the first archive and emits nothing when already archived", async () => {
      const firstDate = new Date("2026-09-15T10:00:00.000Z");
      state.profile = buildProfile({
        archive: { archivedAt: firstDate, archivedById: "first-actor", archiveReason: "first" },
      });

      const result = await service.archive(STUDENT_ID, { reason: "second" }, ACTOR_ID);

      expect(result.archivedAt).toEqual(firstDate);
      expect(result.archivedById).toBe("first-actor");
      expect(result.archiveReason).toBe("first");
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("returns 404 STUDENT_NOT_FOUND for an unknown student", async () => {
      state.profile = null;

      const failure = await httpFailure(service.archive(STUDENT_ID, {}, ACTOR_ID));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "STUDENT_NOT_FOUND",
        message: "Student not found.",
      });
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("unarchive()", () => {
    it("clears the archive columns and emits STUDENT_UNARCHIVED", async () => {
      const archivedAt = new Date("2026-09-15T10:00:00.000Z");
      state.profile = buildProfile({
        archive: { archivedAt, archivedById: ACTOR_ID, archiveReason: "Mudou de cidade." },
      });

      const result = await service.unarchive(STUDENT_ID, ACTOR_ID);

      expect(result.archivedAt).toBeNull();
      expect(result.archivedById).toBeNull();
      expect(result.archiveReason).toBeNull();
      expect(manager.save).toHaveBeenCalledTimes(1);

      expect(order).toEqual(["commit", "emit"]);
      const [event] = emittedEvents();
      expect(event.action).toBe(AuditableAction.STUDENT_UNARCHIVED);
      expect(event.targetId).toBe(STUDENT_ID);
      expect(event.before).toEqual({
        archivedAt,
        archivedById: ACTOR_ID,
        archiveReason: "Mudou de cidade.",
      });
      expect(event.after).toEqual({ archivedAt: null });
    });

    it("is a no-op without event when the student is not archived", async () => {
      const result = await service.unarchive(STUDENT_ID, ACTOR_ID);

      expect(result.archivedAt).toBeNull();
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("returns 404 STUDENT_NOT_FOUND for an unknown student", async () => {
      state.profile = null;

      const failure = await httpFailure(service.unarchive(STUDENT_ID, ACTOR_ID));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "STUDENT_NOT_FOUND",
        message: "Student not found.",
      });
    });
  });

  describe("findByIds()", () => {
    const OTHER_ID = "01999a3e-7c1b-7000-8000-000000000003";

    it("returns [] without querying for an empty list", async () => {
      await expect(service.findByIds([])).resolves.toEqual([]);

      expect(dataSource.getRepository).not.toHaveBeenCalled();
    });

    it("deduplicates ids", async () => {
      profileRepository.find.mockResolvedValue([]);

      await service.findByIds([STUDENT_ID, OTHER_ID, STUDENT_ID]);

      const where = profileRepository.find.mock.calls[0][0].where;
      expect(where.personId).toBeInstanceOf(FindOperator);
      expect(where.personId.value).toEqual([STUDENT_ID, OTHER_ID]);
    });

    it("ignores ids that are not uuids instead of failing", async () => {
      profileRepository.find.mockResolvedValue([]);

      await service.findByIds(["not-a-uuid", STUDENT_ID, "123", ""]);
      const where = profileRepository.find.mock.calls[0][0].where;
      expect(where.personId.value).toEqual([STUDENT_ID]);

      // Nothing valid left: no query at all.
      profileRepository.find.mockClear();
      await expect(service.findByIds(["not-a-uuid", "123"])).resolves.toEqual([]);
      expect(profileRepository.find).not.toHaveBeenCalled();
      expect(dataSource.getRepository).toHaveBeenCalledTimes(1);
    });

    it("filters archived students only when excludeArchived is true", async () => {
      profileRepository.find.mockResolvedValue([]);

      await service.findByIds([STUDENT_ID]);
      await service.findByIds([STUDENT_ID], { excludeArchived: false });
      await service.findByIds([STUDENT_ID], { excludeArchived: true });

      const [withDefault, withFalse, withTrue] = profileRepository.find.mock.calls.map(
        (call) => call[0].where,
      );
      expect(withDefault).not.toHaveProperty("archive");
      expect(withFalse).not.toHaveProperty("archive");
      expect(withTrue.archive.archivedAt).toBeInstanceOf(FindOperator);
      expect(withTrue.archive.archivedAt.type).toBe("isNull");
    });

    it("maps students to the response shape and ignores profiles without a person", async () => {
      const other = buildProfile({ id: "profile-3", personId: OTHER_ID });
      profileRepository.find.mockResolvedValue([buildProfile(), other]);
      personRepository.find.mockResolvedValue([buildPerson({ birthDate: "1958-10-02" })]);

      const result = await service.findByIds([STUDENT_ID, OTHER_ID]);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(STUDENT_ID);
      // São Paulo date 2026-10-01: not yet 68.
      expect(result[0].age).toBe(67);
    });
  });

  describe("findDetail()", () => {
    const CREATOR = Object.assign(new Person(), {
      id: ACTOR_ID,
      name: "Carla Menezes",
      email: "carla@example.com",
      ra: "RA-0001",
      passwordHash: "hash",
      role: Role.DIRECTOR,
      accessEnabled: true,
      birthDate: null,
      phone: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      deletedAt: null,
    });

    beforeEach(() => {
      profileRepository.findOne.mockResolvedValue(buildProfile());
      personRepository.find.mockResolvedValue([buildPerson(), CREATOR]);
    });

    it("returns the record with age from the injected clock and createdBy of the registering person", async () => {
      const result = await service.findDetail(STUDENT_ID);

      expect(result).toEqual({
        id: STUDENT_ID,
        name: "Maria Silva Santos",
        birthDate: "1958-04-12",
        age: 68,
        phone: "43999990000",
        email: "maria.santos@example.com",
        education: "Ensino fundamental completo",
        hasSmartphone: true,
        hasComputer: false,
        howFoundUs: "Indicação de uma amiga",
        emergencyContact: { name: "Ana Santos", phone: "43988887777" },
        accessibilityNeed: AccessibilityNeed.VISUAL,
        supportResource: "Fonte ampliada",
        classNeeds: "Sentar perto do projetor",
        createdAt: CREATED_AT,
        createdBy: { id: ACTOR_ID, name: "Carla Menezes" },
        updatedAt: CREATED_AT,
        archivedAt: null,
        archiveReason: null,
      });

      // Born on 1958-10-02: still 67 on the São Paulo date (2026-10-01), 68 only on the UTC date.
      personRepository.find.mockResolvedValue([buildPerson({ birthDate: "1958-10-02" }), CREATOR]);
      const border = await service.findDetail(STUDENT_ID);
      expect(border.age).toBe(67);
    });

    it("looks up the profile by person id and loads the student and the creator in one query", async () => {
      await service.findDetail(STUDENT_ID);

      expect(dataSource.getRepository).toHaveBeenCalledWith(StudentProfile);
      expect(profileRepository.findOne).toHaveBeenCalledTimes(1);
      expect(profileRepository.findOne).toHaveBeenCalledWith({ where: { personId: STUDENT_ID } });
      expect(personRepository.find).toHaveBeenCalledTimes(1);
      expect(personRepository.find).toHaveBeenCalledWith({
        where: { id: In([STUDENT_ID, ACTOR_ID]) },
      });
    });

    it("returns createdBy null when the creator is not returned (soft-deleted)", async () => {
      personRepository.find.mockResolvedValue([buildPerson()]);

      const result = await service.findDetail(STUDENT_ID);

      expect(result.createdBy).toBeNull();
      expect(result.id).toBe(STUDENT_ID);
    });

    it("throws 404 STUDENT_NOT_FOUND when the person has no student profile, without loading people", async () => {
      profileRepository.findOne.mockResolvedValue(null);

      const failure = await httpFailure(service.findDetail(STUDENT_ID));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "STUDENT_NOT_FOUND",
        message: "Student not found.",
      });
      expect(personRepository.find).not.toHaveBeenCalled();
    });

    it("throws 404 STUDENT_NOT_FOUND when the student's person is not returned (soft-deleted)", async () => {
      personRepository.find.mockResolvedValue([CREATOR]);

      const failure = await httpFailure(service.findDetail(STUDENT_ID));

      expect(failure.getStatus()).toBe(404);
      expect(failure.getResponse()).toEqual({
        error: "STUDENT_NOT_FOUND",
        message: "Student not found.",
      });
    });

    it("keeps an archived student readable", async () => {
      profileRepository.findOne.mockResolvedValue(
        buildProfile({
          archive: { archivedAt: NOW, archivedById: ACTOR_ID, archiveReason: "Mudou de cidade." },
        }),
      );

      const result = await service.findDetail(STUDENT_ID);

      expect(result.archivedAt).toEqual(NOW);
      expect(result.archiveReason).toBe("Mudou de cidade.");
      expect(result.id).toBe(STUDENT_ID);
    });

    it("reads without a transaction, a lock or an audit event", async () => {
      await service.findDetail(STUDENT_ID);

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(manager.findOne).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(profileRepository.findOne.mock.calls[0][0]).not.toHaveProperty("lock");
    });
  });

  describe("privacy", () => {
    it("never logs the record returned by findDetail", async () => {
      const spies = [
        jest.spyOn(Logger.prototype, "log"),
        jest.spyOn(Logger.prototype, "error"),
        jest.spyOn(Logger.prototype, "warn"),
        jest.spyOn(Logger.prototype, "debug"),
        jest.spyOn(Logger.prototype, "verbose"),
        jest.spyOn(console, "log"),
        jest.spyOn(console, "info"),
        jest.spyOn(console, "warn"),
        jest.spyOn(console, "error"),
        jest.spyOn(console, "debug"),
      ];
      for (const spy of spies) spy.mockImplementation(() => undefined);

      try {
        // This test does not go through the beforeEach of describe("findDetail()"): own mocks.
        profileRepository.findOne.mockResolvedValue(buildProfile());
        personRepository.find.mockResolvedValue([buildPerson()]);
        const record = await service.findDetail(STUDENT_ID);
        // Sanity check: the record does carry the sensitive values that must stay out of the logs.
        expect(record.emergencyContact.phone).toBe("43988887777");

        profileRepository.findOne.mockResolvedValue(null);
        await httpFailure(service.findDetail(STUDENT_ID));

        const logged = spies.flatMap((spy) => spy.mock.calls).map((args) => JSON.stringify(args));
        expectNoSensitiveValue(logged.join("\n"));
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    });

    it("never logs phone, e-mail, emergency contact or accessibility values", async () => {
      const spies = [
        jest.spyOn(Logger.prototype, "log"),
        jest.spyOn(Logger.prototype, "error"),
        jest.spyOn(Logger.prototype, "warn"),
        jest.spyOn(Logger.prototype, "debug"),
        jest.spyOn(Logger.prototype, "verbose"),
        jest.spyOn(console, "log"),
        jest.spyOn(console, "info"),
        jest.spyOn(console, "warn"),
        jest.spyOn(console, "error"),
        jest.spyOn(console, "debug"),
      ];
      for (const spy of spies) spy.mockImplementation(() => undefined);

      try {
        await service.create(
          {
            name: "Maria Silva Santos",
            birthDate: "1958-04-12",
            email: "maria.santos@example.com",
            phone: "43999990000",
            emergencyContactName: "Ana Santos",
            emergencyContactPhone: "43988887777",
            accessibilityNeed: AccessibilityNeed.VISUAL,
            supportResource: "Fonte ampliada",
            classNeeds: "Sentar perto do projetor",
          },
          ACTOR_ID,
        );
        await service.update(
          STUDENT_ID,
          { phone: "43911112222", accessibilityNeed: AccessibilityNeed.HEARING },
          ACTOR_ID,
        );
        await service.archive(STUDENT_ID, { reason: "Mudou de cidade." }, ACTOR_ID);
        await service.unarchive(STUDENT_ID, ACTOR_ID);

        const logged = spies.flatMap((spy) => spy.mock.calls).map((args) => JSON.stringify(args));
        expectNoSensitiveValue(logged.join("\n"));
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    });
  });
});
