import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate, ValidationError } from "class-validator";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import { CreateHourEntryDto } from "../dto/create-hour-entry.dto";
import { HoursPeriodQueryDto } from "../dto/hours-period-query.dto";
import { ListMyHourEntriesQueryDto } from "../dto/list-my-hour-entries-query.dto";
import {
  HourEntryCategory,
  LOGGABLE_HOUR_ENTRY_CATEGORIES,
} from "../enums/hour-entry-category.enum";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";

const MEMBER_ID = "01999a3e-0000-7000-8000-0000000000aa";
const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f1";

const CARD_BODY = {
  activity: "Planejamento da aula de teclado e mouse",
  category: "planning",
  date: "2026-03-10",
  declaredMinutes: 150,
};

function fieldsOf(errors: ValidationError[]): string[] {
  return errors.map((error) => error.property).sort();
}

async function checkCreate(body: Record<string, unknown>) {
  const dto = plainToInstance(CreateHourEntryDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: fieldsOf(errors) };
}

async function checkList(query: Record<string, unknown>) {
  const dto = plainToInstance(ListMyHourEntriesQueryDto, query);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: fieldsOf(errors) };
}

async function checkPeriod(query: Record<string, unknown>) {
  const dto = plainToInstance(HoursPeriodQueryDto, query);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: fieldsOf(errors) };
}

describe("CreateHourEntryDto", () => {
  it("accepts the body of the card: 2h30 of planning on a past day, without notes", async () => {
    const { dto, errors } = await checkCreate(CARD_BODY);

    expect(errors).toHaveLength(0);
    expect(dto).toEqual({
      activity: "Planejamento da aula de teclado e mouse",
      category: "planning",
      date: "2026-03-10",
      declaredMinutes: 150,
    });
    expect(dto.notes).toBeUndefined();
  });

  it("requires activity, category, date and declaredMinutes; notes is optional", async () => {
    expect((await checkCreate({})).fields).toEqual([
      "activity",
      "category",
      "date",
      "declaredMinutes",
    ]);

    const { dto, errors } = await checkCreate({ ...CARD_BODY, notes: "Revisei o plano 3." });
    expect(errors).toHaveLength(0);
    expect(dto.notes).toBe("Revisei o plano 3.");
    expect((await checkCreate({ ...CARD_BODY, notes: null })).errors).toHaveLength(0);
  });

  it("rejects the category lesson: lesson hours only come from the attendance (RN-03)", async () => {
    const { errors, fields } = await checkCreate({ ...CARD_BODY, category: "lesson" });

    expect(fields).toEqual(["category"]);
    expect(Object.keys(errors[0].constraints ?? {})).toEqual(["isIn"]);
  });

  it.each(LOGGABLE_HOUR_ENTRY_CATEGORIES)("accepts the category %s", async (category) => {
    expect((await checkCreate({ ...CARD_BODY, category })).errors).toHaveLength(0);
  });

  it("rejects a category outside the enum, and a missing one", async () => {
    for (const category of ["class", "PLANNING", "", null, 1]) {
      expect((await checkCreate({ ...CARD_BODY, category })).fields).toEqual(["category"]);
    }
  });

  it("rejects 0 and 1441 minutes, accepts 1 and 1440", async () => {
    for (const declaredMinutes of [0, -30, 1441]) {
      expect((await checkCreate({ ...CARD_BODY, declaredMinutes })).fields).toEqual([
        "declaredMinutes",
      ]);
    }
    for (const declaredMinutes of [1, 1440]) {
      expect((await checkCreate({ ...CARD_BODY, declaredMinutes })).errors).toHaveLength(0);
    }
  });

  it('rejects a fractional number of minutes and the string "150"', async () => {
    for (const declaredMinutes of [1.5, 150.25, "150", null, true]) {
      expect((await checkCreate({ ...CARD_BODY, declaredMinutes })).fields).toEqual([
        "declaredMinutes",
      ]);
    }
  });

  it("trims the activity and rejects a blank one; turns blank notes into null", async () => {
    const trimmed = await checkCreate({
      ...CARD_BODY,
      activity: "  Reunião de equipe  ",
      notes: "  Pauta: calendário.  ",
    });
    expect(trimmed.errors).toHaveLength(0);
    expect(trimmed.dto.activity).toBe("Reunião de equipe");
    expect(trimmed.dto.notes).toBe("Pauta: calendário.");

    for (const activity of ["", "   ", null, 123, ["Reunião"]]) {
      expect((await checkCreate({ ...CARD_BODY, activity })).fields).toEqual(["activity"]);
    }

    const blankNotes = await checkCreate({ ...CARD_BODY, notes: "   " });
    expect(blankNotes.errors).toHaveLength(0);
    expect(blankNotes.dto.notes).toBeNull();
  });

  it("rejects an activity over 200 characters and notes over 2000", async () => {
    expect((await checkCreate({ ...CARD_BODY, activity: "a".repeat(200) })).errors).toHaveLength(0);
    expect((await checkCreate({ ...CARD_BODY, activity: "a".repeat(201) })).fields).toEqual([
      "activity",
    ]);
    expect((await checkCreate({ ...CARD_BODY, notes: "n".repeat(2000) })).errors).toHaveLength(0);
    expect((await checkCreate({ ...CARD_BODY, notes: "n".repeat(2001) })).fields).toEqual([
      "notes",
    ]);
    expect((await checkCreate({ ...CARD_BODY, notes: 42 })).fields).toEqual(["notes"]);
  });

  it("rejects a date that is not YYYY-MM-DD or does not exist (2026-02-30, 10/03/2026)", async () => {
    for (const date of [
      "2026-02-30",
      "10/03/2026",
      "2026-3-10",
      "2026-03-10T10:00:00Z",
      "",
      20260310,
    ]) {
      expect((await checkCreate({ ...CARD_BODY, date })).fields).toEqual(["date"]);
    }
    expect((await checkCreate({ ...CARD_BODY, date: "2024-02-29" })).errors).toHaveLength(0);
  });

  it("drops personId, status, origin, validatedMinutes, classId and lessonId through the global pipe", async () => {
    const transformed: unknown = await buildValidationPipe().transform(
      {
        ...CARD_BODY,
        personId: MEMBER_ID,
        status: "approved",
        origin: "attendance",
        validatedMinutes: 150,
        classId: CLASS_ID,
        lessonId: LESSON_ID,
        createdById: MEMBER_ID,
      },
      { type: "body", metatype: CreateHourEntryDto },
    );

    expect(transformed).toBeInstanceOf(CreateHourEntryDto);
    expect(transformed).toEqual({
      activity: "Planejamento da aula de teclado e mouse",
      category: "planning",
      date: "2026-03-10",
      declaredMinutes: 150,
    });
  });
});

describe("ListMyHourEntriesQueryDto", () => {
  it("accepts an empty query: every filter is optional", async () => {
    const { dto, errors } = await checkList({});

    expect(errors).toHaveLength(0);
    expect(dto).toEqual({});
  });

  it("converts page and limit from the query string and rejects limit above 100", async () => {
    const { dto, errors } = await checkList({ page: "2", limit: "100" });
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(100);

    expect((await checkList({ limit: "101" })).fields).toEqual(["limit"]);
    expect((await checkList({ limit: "0" })).fields).toEqual(["limit"]);
    expect((await checkList({ page: "0" })).fields).toEqual(["page"]);
    expect((await checkList({ page: "abc" })).fields).toEqual(["page"]);
    expect((await checkList({ page: "1.5" })).fields).toEqual(["page"]);
  });

  it("accepts status, category (lesson included) and the period, and rejects values outside the enums", async () => {
    const { dto, errors } = await checkList({
      status: "adjusted",
      category: "lesson",
      from: "2026-03-01",
      to: "2026-03-31",
    });
    expect(errors).toHaveLength(0);
    expect(dto).toEqual({
      status: HourEntryStatus.ADJUSTED,
      category: HourEntryCategory.LESSON,
      from: "2026-03-01",
      to: "2026-03-31",
    });

    for (const status of Object.values(HourEntryStatus)) {
      expect((await checkList({ status })).errors).toHaveLength(0);
    }
    for (const category of Object.values(HourEntryCategory)) {
      expect((await checkList({ category })).errors).toHaveLength(0);
    }
    expect((await checkList({ status: "open" })).fields).toEqual(["status"]);
    expect((await checkList({ category: "class" })).fields).toEqual(["category"]);
    expect((await checkList({ status: ["pending", "approved"] })).fields).toEqual(["status"]);
  });

  it("rejects from and to that are not calendar dates", async () => {
    expect((await checkList({ from: "2026-02-30", to: "31/03/2026" })).fields).toEqual([
      "from",
      "to",
    ]);
  });
});

describe("HoursPeriodQueryDto", () => {
  it("accepts an open period, a half-open one and a closed one", async () => {
    expect((await checkPeriod({})).errors).toHaveLength(0);
    expect((await checkPeriod({ from: "2026-03-01" })).errors).toHaveLength(0);
    expect((await checkPeriod({ to: "2026-03-31" })).errors).toHaveLength(0);
    expect((await checkPeriod({ from: "2026-03-01", to: "2026-03-31" })).errors).toHaveLength(0);
  });

  it("rejects from and to that are not calendar dates", async () => {
    expect((await checkPeriod({ from: "2026-3-1", to: "2026-13-01" })).fields).toEqual([
      "from",
      "to",
    ]);
    expect((await checkPeriod({ from: "" })).fields).toEqual(["from"]);
  });
});
