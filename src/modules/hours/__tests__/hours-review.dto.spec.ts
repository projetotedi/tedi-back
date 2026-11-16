import "reflect-metadata";
import { ClassConstructor, plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { AdjustHourEntryDto } from "../dto/adjust-hour-entry.dto";
import { RejectHourEntryDto } from "../dto/reject-hour-entry.dto";
import { ValidateHourEntriesDto } from "../dto/validate-hour-entries.dto";

const ENTRY_ID = "01999a3e-7c1b-7000-8000-000000000a01";

/** A uuid v7 per index, all different. */
function uuidOf(index: number): string {
  return `01999a3e-7c1b-7000-8000-${index.toString(16).padStart(12, "0")}`;
}

async function check<T extends object>(dto: ClassConstructor<T>, body: Record<string, unknown>) {
  const instance = plainToInstance(dto, body);
  const errors = await validate(instance, { whitelist: true });
  return { instance, fields: errors.map((error) => error.property).sort() };
}

describe("ValidateHourEntriesDto", () => {
  it("accepts from 1 to 100 uuids, upper case included", async () => {
    for (const ids of [
      [ENTRY_ID],
      [ENTRY_ID.toUpperCase(), uuidOf(2)],
      Array.from({ length: 100 }, (_, index) => uuidOf(index)),
    ]) {
      expect((await check(ValidateHourEntriesDto, { ids })).fields).toEqual([]);
    }
  });

  it("rejects an empty list, 101 ids, a malformed id and a value that is not a list", async () => {
    for (const ids of [
      [],
      Array.from({ length: 101 }, (_, index) => uuidOf(index)),
      [ENTRY_ID, "not-a-uuid"],
      ENTRY_ID,
      undefined,
    ]) {
      expect((await check(ValidateHourEntriesDto, { ids })).fields).toEqual(["ids"]);
    }
  });

  it("lets a repeated id through: the service answers DUPLICATE_HOUR_ENTRY with the positions", async () => {
    expect((await check(ValidateHourEntriesDto, { ids: [ENTRY_ID, ENTRY_ID] })).fields).toEqual([]);
  });
});

describe("AdjustHourEntryDto", () => {
  const body = { validatedMinutes: 120, justification: "A reunião durou duas horas." };

  it('accepts 1 and 1440 minutes and rejects 0, 1441, 1.5 and "120"', async () => {
    for (const validatedMinutes of [1, 1440]) {
      expect((await check(AdjustHourEntryDto, { ...body, validatedMinutes })).fields).toEqual([]);
    }
    for (const validatedMinutes of [0, -1, 1441, 1.5, "120", null]) {
      expect((await check(AdjustHourEntryDto, { ...body, validatedMinutes })).fields).toEqual([
        "validatedMinutes",
      ]);
    }
  });

  it("trims the justification, requires it and rejects one over 500 characters", async () => {
    const { instance, fields } = await check(AdjustHourEntryDto, {
      ...body,
      justification: "  Duas horas.  ",
    });
    expect(fields).toEqual([]);
    expect(instance.justification).toBe("Duas horas.");

    expect(
      (await check(AdjustHourEntryDto, { ...body, justification: "a".repeat(500) })).fields,
    ).toEqual([]);
    for (const justification of ["", "   ", undefined, 42, "a".repeat(501)]) {
      expect((await check(AdjustHourEntryDto, { ...body, justification })).fields).toEqual([
        "justification",
      ]);
    }
  });
});

describe("RejectHourEntryDto", () => {
  it("trims the reason, requires it and rejects one over 500 characters", async () => {
    const { instance, fields } = await check(RejectHourEntryDto, { reason: "  Fora do projeto. " });
    expect(fields).toEqual([]);
    expect(instance.reason).toBe("Fora do projeto.");

    expect((await check(RejectHourEntryDto, { reason: "a".repeat(500) })).fields).toEqual([]);
    for (const reason of ["", "   ", undefined, 42, "a".repeat(501)]) {
      expect((await check(RejectHourEntryDto, { reason })).fields).toEqual(["reason"]);
    }
  });
});
