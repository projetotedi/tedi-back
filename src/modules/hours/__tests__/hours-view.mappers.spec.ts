import "reflect-metadata";
import { HourEntryEvent } from "../entities/hour-entry-event.entity";
import { HourEntry } from "../entities/hour-entry.entity";
import { HourEntryCategory } from "../enums/hour-entry-category.enum";
import { HourEntryEventType } from "../enums/hour-entry-event-type.enum";
import { HourEntryOrigin } from "../enums/hour-entry-origin.enum";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";
import { toHourEntryResponse } from "../services/hour-entry-response.mapper";
import {
  toHourEntryEventResponse,
  toHoursMemberTotal,
  toMemberHourEntry,
} from "../services/hours-view.mappers";
import { NO_CANCELLED_LESSONS } from "../services/hour-entry-lessons";

const AT = new Date("2026-03-12T13:00:00.000Z");
const ENTRY_ID = "01999a3e-7c1b-7000-8000-000000000a01";
const PERSON_ID = "01999a3e-0000-7000-8000-0000000000a1";
const COORDINATOR_ID = "01999a3e-0000-7000-8000-0000000000ee";
const TECH = "01999a3e-1111-7000-8000-000000000001";

const ENTRY = Object.assign(new HourEntry(), {
  id: ENTRY_ID,
  personId: PERSON_ID,
  createdById: PERSON_ID,
  origin: HourEntryOrigin.MANUAL,
  activity: "Reunião de planejamento",
  category: HourEntryCategory.MEETING,
  date: "2026-03-11",
  declaredMinutes: 240,
  validatedMinutes: 120,
  notes: "Pauta: calendário.",
  status: HourEntryStatus.ADJUSTED,
  classId: null,
  lessonId: null,
  reviewNote: "Duas horas.",
  reviewedById: COORDINATOR_ID,
  reviewedAt: AT,
  createdAt: AT,
  updatedAt: AT,
  deletedAt: null,
});

describe("hours view mappers", () => {
  it("maps every field of an event, with the actor, and never updatedAt nor deletedAt", () => {
    const event = Object.assign(new HourEntryEvent(), {
      id: "01999a3e-7c1b-7000-8000-000000000e01",
      hourEntryId: ENTRY_ID,
      type: HourEntryEventType.ADJUSTED,
      actorId: COORDINATOR_ID,
      fromStatus: HourEntryStatus.PENDING,
      toStatus: HourEntryStatus.ADJUSTED,
      fromMinutes: 240,
      toMinutes: 120,
      note: "Duas horas.",
      createdAt: AT,
      updatedAt: new Date("2030-01-01T00:00:00.000Z"),
      deletedAt: null,
    });
    const actor = { id: COORDINATOR_ID, name: "Carla Coordenadora" };

    const mapped = toHourEntryEventResponse(event, actor);

    expect(mapped).toEqual({
      id: "01999a3e-7c1b-7000-8000-000000000e01",
      hourEntryId: ENTRY_ID,
      type: HourEntryEventType.ADJUSTED,
      actor,
      fromStatus: HourEntryStatus.PENDING,
      toStatus: HourEntryStatus.ADJUSTED,
      fromMinutes: 240,
      toMinutes: 120,
      note: "Duas horas.",
      createdAt: AT,
    });
    expect(mapped).not.toHaveProperty("updatedAt");
    expect(mapped).not.toHaveProperty("deletedAt");
    expect(mapped).not.toHaveProperty("actorId");
    expect(toHourEntryEventResponse(event, null).actor).toBeNull();
  });

  it("maps a member total and keeps the member null when it is not found", () => {
    const row = {
      personId: PERSON_ID,
      entries: 4,
      declaredMinutes: 600,
      bankMinutes: 180,
      pendingEntries: 1,
      pendingMinutes: 90,
    };
    const member = { id: PERSON_ID, name: "Ana Souza", department: null };

    expect(toHoursMemberTotal(row, member)).toEqual({ ...row, member });
    expect(toHoursMemberTotal(row, null)).toEqual({ ...row, member: null });
    expect(() => toHoursMemberTotal({ ...row, bankMinutes: Number.NaN }, null)).toThrow(
      "Hours overview row with a total that is not a whole number.",
    );
  });

  it("adds the member to every field of the entry", () => {
    const member = {
      id: PERSON_ID,
      name: "Ana Souza",
      department: { id: TECH, name: "Tecnologia" },
    };

    const none = NO_CANCELLED_LESSONS;
    expect(toMemberHourEntry(ENTRY, member, none)).toEqual({
      ...toHourEntryResponse(ENTRY, none),
      member,
    });
    expect(toMemberHourEntry(ENTRY, null, none)).toEqual({
      ...toHourEntryResponse(ENTRY, none),
      member: null,
    });
    expect(toMemberHourEntry(ENTRY, member, none)).not.toHaveProperty("deletedAt");
  });
});
