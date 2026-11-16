import "reflect-metadata";
import { HourEntry } from "../entities/hour-entry.entity";
import { HourEntryCategory } from "../enums/hour-entry-category.enum";
import { HourEntryOrigin } from "../enums/hour-entry-origin.enum";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";
import { toHourEntryResponse } from "../services/hour-entry-response.mapper";

const ENTRY_ID = "01999a3e-7c1b-7000-8000-000000000a01";
const MEMBER_ID = "01999a3e-0000-7000-8000-0000000000aa";
const DIRECTOR_ID = "01999a3e-0000-7000-8000-0000000000bb";
const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
const CREATED_AT = new Date("2026-03-10T21:00:00.000Z");
const UPDATED_AT = new Date("2026-03-12T13:00:00.000Z");

function buildEntry(overrides: Partial<HourEntry> = {}): HourEntry {
  return Object.assign(new HourEntry(), {
    id: ENTRY_ID,
    personId: MEMBER_ID,
    activity: "Planejamento da aula de teclado e mouse",
    category: HourEntryCategory.PLANNING,
    date: "2026-03-10",
    declaredMinutes: 150,
    validatedMinutes: null,
    notes: null,
    status: HourEntryStatus.PENDING,
    origin: HourEntryOrigin.MANUAL,
    createdById: MEMBER_ID,
    classId: null,
    lessonId: null,
    reviewNote: null,
    reviewedById: null,
    reviewedAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    ...overrides,
  });
}

describe("toHourEntryResponse", () => {
  it("maps every field of the entry, with null for the optional ones", () => {
    expect(toHourEntryResponse(buildEntry())).toEqual({
      id: ENTRY_ID,
      personId: MEMBER_ID,
      activity: "Planejamento da aula de teclado e mouse",
      category: HourEntryCategory.PLANNING,
      date: "2026-03-10",
      declaredMinutes: 150,
      validatedMinutes: null,
      notes: null,
      status: HourEntryStatus.PENDING,
      origin: HourEntryOrigin.MANUAL,
      createdById: MEMBER_ID,
      classId: null,
      lessonId: null,
      reviewNote: null,
      reviewedById: null,
      reviewedAt: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
  });

  it("maps a reviewed entry of the attendance with every optional field filled", () => {
    const reviewed = buildEntry({
      category: HourEntryCategory.LESSON,
      origin: HourEntryOrigin.ATTENDANCE,
      createdById: DIRECTOR_ID,
      classId: CLASS_ID,
      lessonId: LESSON_ID,
      notes: "Aula de teclado.",
      status: HourEntryStatus.ADJUSTED,
      validatedMinutes: 120,
      reviewNote: "A aula durou duas horas.",
      reviewedById: DIRECTOR_ID,
      reviewedAt: UPDATED_AT,
      updatedAt: UPDATED_AT,
    });

    expect(toHourEntryResponse(reviewed)).toMatchObject({
      category: HourEntryCategory.LESSON,
      origin: HourEntryOrigin.ATTENDANCE,
      createdById: DIRECTOR_ID,
      classId: CLASS_ID,
      lessonId: LESSON_ID,
      notes: "Aula de teclado.",
      status: HourEntryStatus.ADJUSTED,
      validatedMinutes: 120,
      reviewNote: "A aula durou duas horas.",
      reviewedById: DIRECTOR_ID,
      reviewedAt: UPDATED_AT,
      updatedAt: UPDATED_AT,
    });
  });

  it("never exposes deletedAt", () => {
    const removed = buildEntry({ deletedAt: UPDATED_AT });

    expect(toHourEntryResponse(removed)).not.toHaveProperty("deletedAt");
  });
});
