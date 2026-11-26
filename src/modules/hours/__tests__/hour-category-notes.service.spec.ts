import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Test } from "@nestjs/testing";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { DataSource } from "typeorm";
import { MembersService } from "@modules/people/services/members.service";
import { Clock } from "@shared/dates/clock";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { Role } from "@shared/enums/role.enum";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { PermissionPolicy } from "@shared/permissions/permission.policy";
import { SetHourCategoryNoteDto } from "../dto/set-hour-category-note.dto";
import { HourCategoryNote } from "../entities/hour-category-note.entity";
import { HourEntryCategory } from "../enums/hour-entry-category.enum";
import { HourCategoryNotesService } from "../services/hour-category-notes.service";

const NOW = new Date("2026-11-23T14:00:00.000Z");
const TECH = "01999a3e-1111-7000-8000-000000000001";
const ANA = "01999a3e-0000-7000-8000-0000000000aa";
const NOTE_ID = "01999a3e-7c1b-7000-8000-000000000b01";
const ANA_REF = { id: ANA, name: "Ana Souza", department: { id: TECH, name: "Tecnologia" } };

const COORDINATOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000ee",
  role: Role.COORDINATOR,
  accessEnabled: true,
  departmentIds: [],
};
const SUPERADMIN: AuthUser = { ...COORDINATOR, role: Role.SUPERADMIN };
const DIRECTOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000bb",
  role: Role.DIRECTOR,
  accessEnabled: true,
  departmentIds: [TECH],
};

async function httpFailure(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return error as HttpException;
  }
  throw new Error("Expected the promise to reject with an HttpException");
}

function codeOf(failure: HttpException): string {
  return (failure.getResponse() as { error: string }).error;
}

describe("HourCategoryNotesService", () => {
  let service: HourCategoryNotesService;

  const noteRepository = { find: jest.fn() };
  const dataSource = { query: jest.fn(), getRepository: jest.fn() };
  const eventEmitter = { emit: jest.fn() };
  const clock = { now: jest.fn() };
  const members = { findMemberRefs: jest.fn() };

  function savedRow(note: string | null) {
    return {
      id: NOTE_ID,
      person_id: ANA,
      category: HourEntryCategory.PLANNING,
      note,
      updated_by_id: COORDINATOR.id,
      updated_at: NOW,
    };
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    clock.now.mockReturnValue(NOW);
    members.findMemberRefs.mockResolvedValue([ANA_REF]);
    dataSource.query.mockImplementation(async (_sql: string, params: unknown[]) => [
      savedRow(params[3] as string | null),
    ]);
    dataSource.getRepository.mockImplementation((target: unknown) =>
      target === HourCategoryNote ? noteRepository : undefined,
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        HourCategoryNotesService,
        PermissionPolicy,
        { provide: DataSource, useValue: dataSource },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: Clock, useValue: clock },
        { provide: MembersService, useValue: members },
      ],
    }).compile();
    service = moduleRef.get(HourCategoryNotesService);
  });

  describe("setNote", () => {
    it("upserts the observation of the category on the unique index, by the actor, at the instant of the Clock", async () => {
      const saved = await service.setNote(
        ANA.toUpperCase(),
        { category: HourEntryCategory.PLANNING, note: "Aguardando validação da coordenação." },
        COORDINATOR,
      );

      expect(members.findMemberRefs).toHaveBeenCalledWith({ ids: [ANA.toUpperCase()] });
      expect(dataSource.query).toHaveBeenCalledTimes(1);
      const [sql, params] = dataSource.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain(`ON CONFLICT ("person_id", "category") WHERE "deleted_at" IS NULL`);
      expect(params.slice(1)).toEqual([
        ANA,
        HourEntryCategory.PLANNING,
        "Aguardando validação da coordenação.",
        COORDINATOR.id,
        NOW,
      ]);
      expect(saved).toEqual({
        personId: ANA,
        category: HourEntryCategory.PLANNING,
        note: "Aguardando validação da coordenação.",
        updatedById: COORDINATOR.id,
        updatedAt: NOW,
      });
    });

    it("clears the observation with null, keeping the row", async () => {
      const saved = await service.setNote(
        ANA,
        { category: HourEntryCategory.PLANNING, note: null },
        COORDINATOR,
      );

      expect((dataSource.query.mock.calls[0] as [string, unknown[]])[1][3]).toBeNull();
      expect(saved.note).toBeNull();
    });

    it("emits HOUR_CATEGORY_NOTE_UPDATED with whether there is an observation, never its text (RNF-13)", async () => {
      await service.setNote(
        ANA,
        { category: HourEntryCategory.PLANNING, note: "Texto livre da coordenação." },
        SUPERADMIN,
      );

      const events = eventEmitter.emit.mock.calls
        .filter((call) => call[0] === AUDITABLE_ACTION_EVENT)
        .map((call) => call[1] as AuditableActionEvent);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: AuditableAction.HOUR_CATEGORY_NOTE_UPDATED,
        actorId: SUPERADMIN.id,
        targetType: "hour_category_note",
        targetId: NOTE_ID,
        before: null,
        after: { personId: ANA, category: HourEntryCategory.PLANNING, hasNote: true },
        occurredAt: NOW,
      });
      expect(JSON.stringify(events[0])).not.toContain("Texto livre");
    });

    it("throws MEMBER_NOT_FOUND for someone who is not a member, before the scope and without writing", async () => {
      members.findMemberRefs.mockResolvedValue([]);

      const failure = await httpFailure(
        service.setNote(ANA, { category: HourEntryCategory.PLANNING, note: "x" }, DIRECTOR),
      );

      expect(failure.getStatus()).toBe(404);
      expect(codeOf(failure)).toBe("MEMBER_NOT_FOUND");
      expect(dataSource.query).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it("throws FORBIDDEN_SCOPE to a director, even of the department of the member: only coordination writes (RN-06)", async () => {
      const failure = await httpFailure(
        service.setNote(ANA, { category: HourEntryCategory.PLANNING, note: "x" }, DIRECTOR),
      );

      expect(failure.getStatus()).toBe(403);
      expect(codeOf(failure)).toBe("FORBIDDEN_SCOPE");
      expect(dataSource.query).not.toHaveBeenCalled();
    });
  });

  describe("notesOf", () => {
    it("reads the observations of one person by category, leaving the cleared ones out", async () => {
      noteRepository.find.mockResolvedValue([
        { category: HourEntryCategory.PLANNING, note: "Aguardando validação da coordenação." },
        { category: HourEntryCategory.EVENT, note: null },
      ]);

      const notes = await service.notesOf(ANA);

      expect(noteRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ personId: ANA }) }),
      );
      expect([...notes]).toEqual([
        [HourEntryCategory.PLANNING, "Aguardando validação da coordenação."],
      ]);
    });
  });
});

describe("SetHourCategoryNoteDto", () => {
  async function check(body: Record<string, unknown>) {
    const dto = plainToInstance(SetHourCategoryNoteDto, body);
    const errors = await validate(dto, { whitelist: true });
    return { dto, fields: errors.map((error) => error.property).sort() };
  }

  it("takes every category, lesson included, and trims the note", async () => {
    for (const category of Object.values(HourEntryCategory)) {
      expect((await check({ category, note: "x" })).fields).toEqual([]);
    }
    expect((await check({ category: "planning", note: "  Conferido.  " })).dto.note).toBe(
      "Conferido.",
    );
  });

  it("turns a blank or omitted note into null, which clears the observation", async () => {
    const blank = await check({ category: "planning", note: "   " });
    const omitted = await check({ category: "planning" });

    expect(blank.fields).toEqual([]);
    expect(blank.dto.note).toBeNull();
    expect(omitted.fields).toEqual([]);
  });

  it("rejects an unknown category, a note that is not text and a note over 500 characters", async () => {
    expect((await check({ category: "class", note: "x" })).fields).toEqual(["category"]);
    expect((await check({ note: "x" })).fields).toEqual(["category"]);
    expect((await check({ category: "planning", note: 42 })).fields).toEqual(["note"]);
    expect((await check({ category: "planning", note: "a".repeat(501) })).fields).toEqual(["note"]);
    expect((await check({ category: "planning", note: "a".repeat(500) })).fields).toEqual([]);
  });
});
