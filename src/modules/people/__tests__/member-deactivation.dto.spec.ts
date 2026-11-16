import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate, ValidationError } from "class-validator";
import { todayInAppTimeZone } from "@shared/dates/calendar-date";
import { flattenValidationErrors } from "@shared/filters/http-exception.filter";
import { DeactivateMemberDto } from "../dto/deactivate-member.dto";
import { ListMembersQueryDto } from "../dto/list-members-query.dto";
import { MemberStatus } from "../enums/member-status.enum";

const VALID_DEACTIVATION = {
  exitDate: "2026-09-30",
  reason: "Formou-se.",
  note: "Vai fazer mestrado em outra cidade.",
};

function fieldsOf(errors: ValidationError[]): string[] {
  return errors.map((error) => error.property).sort();
}

/** Next calendar day of a "YYYY-MM-DD" date, computed on the string (no local time zone). */
function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function checkDeactivation(body: Record<string, unknown>) {
  const dto = plainToInstance(DeactivateMemberDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: fieldsOf(errors) };
}

describe("DeactivateMemberDto", () => {
  it("accepts exitDate, reason and note, trimming reason and note", async () => {
    const { dto, errors } = await checkDeactivation({
      exitDate: "2026-09-30",
      reason: "  Formou-se. ",
      note: " Vai fazer mestrado em outra cidade.  ",
    });

    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject(VALID_DEACTIVATION);

    const withoutNote = await checkDeactivation({ exitDate: "2026-09-30", reason: "Formou-se." });
    expect(withoutNote.errors).toHaveLength(0);
    expect(withoutNote.dto.note).toBeUndefined();
  });

  it("accepts today and 2000-01-01 as exitDate", async () => {
    for (const exitDate of [todayInAppTimeZone(), "2000-01-01"]) {
      expect((await checkDeactivation({ ...VALID_DEACTIVATION, exitDate })).errors).toHaveLength(0);
    }
  });

  it("reports exitDate when missing, in the future, before 2000-01-01, impossible or not YYYY-MM-DD", async () => {
    const { exitDate: _omitted, ...withoutExitDate } = VALID_DEACTIVATION;
    const missing = await checkDeactivation(withoutExitDate);
    expect(missing.fields).toEqual(["exitDate"]);
    expect(flattenValidationErrors(missing.errors)).toEqual([
      {
        field: "exitDate",
        message: "exitDate must be a date in YYYY-MM-DD format between 2000-01-01 and today",
      },
    ]);

    for (const exitDate of [
      nextDay(todayInAppTimeZone()),
      "1999-12-31",
      "2026-02-30",
      "30/09/2026",
      "2026-9-30",
      "",
      20260930,
      null,
    ]) {
      expect((await checkDeactivation({ ...VALID_DEACTIVATION, exitDate })).fields).toEqual([
        "exitDate",
      ]);
    }
  });

  it("reports reason when missing, blank, not a string or longer than 200", async () => {
    const { reason: _omitted, ...withoutReason } = VALID_DEACTIVATION;
    expect((await checkDeactivation(withoutReason)).fields).toEqual(["reason"]);

    for (const reason of ["", "   ", null, 12, "a".repeat(201)]) {
      expect((await checkDeactivation({ ...VALID_DEACTIVATION, reason })).fields).toEqual([
        "reason",
      ]);
    }
    expect(
      (await checkDeactivation({ ...VALID_DEACTIVATION, reason: "a".repeat(200) })).errors,
    ).toHaveLength(0);
  });

  it("turns a blank note into null and reports a note longer than 2000", async () => {
    for (const note of ["", "   ", null]) {
      const { dto, errors } = await checkDeactivation({ ...VALID_DEACTIVATION, note });
      expect(errors).toHaveLength(0);
      expect(dto.note).toBeNull();
    }

    expect(
      (await checkDeactivation({ ...VALID_DEACTIVATION, note: "a".repeat(2001) })).fields,
    ).toEqual(["note"]);
    expect((await checkDeactivation({ ...VALID_DEACTIVATION, note: 12 })).fields).toEqual(["note"]);
    expect(
      (await checkDeactivation({ ...VALID_DEACTIVATION, note: "a".repeat(2000) })).errors,
    ).toHaveLength(0);
  });
});

async function checkListQuery(query: Record<string, unknown>) {
  const dto = plainToInstance(ListMembersQueryDto, query);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: fieldsOf(errors) };
}

describe("ListMembersQueryDto status", () => {
  it("accepts status active and inactive and reports any other value", async () => {
    for (const status of [MemberStatus.ACTIVE, MemberStatus.INACTIVE]) {
      const { dto, errors } = await checkListQuery({ status });
      expect(errors).toHaveLength(0);
      expect(dto.status).toBe(status);
    }
    expect((await checkListQuery({})).errors).toHaveLength(0);

    for (const status of ["unknown", "ACTIVE", "", "pending", 1]) {
      expect((await checkListQuery({ status })).fields).toEqual(["status"]);
    }
  });
});
