import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate, ValidationError } from "class-validator";
import { todayInAppTimeZone } from "@shared/dates/calendar-date";
import { CreateStudentDto } from "../dto/create-student.dto";
import { UpdateStudentDto } from "../dto/update-student.dto";
import { AccessibilityNeed } from "../enums/accessibility-need.enum";

const VALID_BODY = { name: "Maria Silva Santos", birthDate: "1958-04-12" };

function fieldsOf(errors: ValidationError[]): string[] {
  return errors.map((error) => error.property).sort();
}

async function checkCreate(body: Record<string, unknown>) {
  const dto = plainToInstance(CreateStudentDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: fieldsOf(errors) };
}

async function checkUpdate(body: Record<string, unknown>) {
  const dto = plainToInstance(UpdateStudentDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: fieldsOf(errors) };
}

/** Next calendar day of a "YYYY-MM-DD" date, computed on the string (no local time zone). */
function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

describe("CreateStudentDto", () => {
  it("accepts Maria Silva Santos born 1958-04-12", async () => {
    const { dto, errors } = await checkCreate(VALID_BODY);

    expect(errors).toHaveLength(0);
    expect(dto.name).toBe("Maria Silva Santos");
    expect(dto.birthDate).toBe("1958-04-12");
    expect(dto.accessibilityNeed).toBeUndefined();
  });

  it("reports field name when name is missing or blank", async () => {
    expect((await checkCreate({ birthDate: "1958-04-12" })).fields).toEqual(["name"]);
    expect((await checkCreate({ ...VALID_BODY, name: "   " })).fields).toEqual(["name"]);
    expect((await checkCreate({ ...VALID_BODY, name: "a".repeat(201) })).fields).toEqual(["name"]);
  });

  it("reports field birthDate when birthDate is missing", async () => {
    expect((await checkCreate({ name: "Maria Silva Santos" })).fields).toEqual(["birthDate"]);
  });

  it("rejects birthDate in dd/mm/yyyy, impossible dates and datetimes", async () => {
    for (const birthDate of [
      "12/04/1958",
      "1958-4-12",
      "1958-02-30",
      "1959-02-29",
      "1958-04-12T00:00:00Z",
      "",
      19580412,
      null,
    ]) {
      const { fields } = await checkCreate({ ...VALID_BODY, birthDate });
      expect(fields).toEqual(["birthDate"]);
    }
  });

  it("rejects a birthDate after today in America/Sao_Paulo", async () => {
    const today = todayInAppTimeZone();

    expect((await checkCreate({ ...VALID_BODY, birthDate: nextDay(today) })).fields).toEqual([
      "birthDate",
    ]);
    expect((await checkCreate({ ...VALID_BODY, birthDate: today })).errors).toHaveLength(0);
  });

  it("rejects a birthDate before 1900-01-01", async () => {
    expect((await checkCreate({ ...VALID_BODY, birthDate: "1899-12-31" })).fields).toEqual([
      "birthDate",
    ]);
    expect((await checkCreate({ ...VALID_BODY, birthDate: "1900-01-01" })).errors).toHaveLength(0);
  });

  it("normalizes phone and emergencyContactPhone to digits", async () => {
    const { dto, errors } = await checkCreate({
      ...VALID_BODY,
      phone: "(43) 99999-0000",
      emergencyContactPhone: "+55 43 98888-7777",
    });

    expect(errors).toHaveLength(0);
    expect(dto.phone).toBe("43999990000");
    expect(dto.emergencyContactPhone).toBe("5543988887777");

    const blank = await checkCreate({ ...VALID_BODY, phone: "  ", emergencyContactPhone: "" });
    expect(blank.errors).toHaveLength(0);
    expect(blank.dto.phone).toBeNull();
    expect(blank.dto.emergencyContactPhone).toBeNull();
  });

  it("rejects a phone with letters or fewer than 10 digits", async () => {
    expect((await checkCreate({ ...VALID_BODY, phone: "4399999abcd" })).fields).toEqual(["phone"]);
    expect((await checkCreate({ ...VALID_BODY, phone: "999990000" })).fields).toEqual(["phone"]);
    expect((await checkCreate({ ...VALID_BODY, phone: "12345678901234" })).fields).toEqual([
      "phone",
    ]);
    expect((await checkCreate({ ...VALID_BODY, emergencyContactPhone: "12345" })).fields).toEqual([
      "emergencyContactPhone",
    ]);
  });

  it("lowercases and trims email and rejects an invalid one", async () => {
    const valid = await checkCreate({ ...VALID_BODY, email: "  Maria.Santos@Example.COM " });
    expect(valid.errors).toHaveLength(0);
    expect(valid.dto.email).toBe("maria.santos@example.com");

    const blank = await checkCreate({ ...VALID_BODY, email: "   " });
    expect(blank.errors).toHaveLength(0);
    expect(blank.dto.email).toBeNull();

    expect((await checkCreate({ ...VALID_BODY, email: "not-an-email" })).fields).toEqual(["email"]);
  });

  it("rejects an accessibilityNeed outside the enum", async () => {
    for (const value of Object.values(AccessibilityNeed)) {
      expect((await checkCreate({ ...VALID_BODY, accessibilityNeed: value })).errors).toHaveLength(
        0,
      );
    }

    expect((await checkCreate({ ...VALID_BODY, accessibilityNeed: "blind" })).fields).toEqual([
      "accessibilityNeed",
    ]);
    // null is rejected too: "none" already means "no need".
    expect((await checkCreate({ ...VALID_BODY, accessibilityNeed: null })).fields).toEqual([
      "accessibilityNeed",
    ]);
  });
});

describe("UpdateStudentDto", () => {
  it("accepts a partial body", async () => {
    expect((await checkUpdate({})).errors).toHaveLength(0);

    const { dto, errors } = await checkUpdate({ phone: "(43) 91111-2222", name: "  Maria  " });
    expect(errors).toHaveLength(0);
    expect(dto.phone).toBe("43911112222");
    expect(dto.name).toBe("Maria");
    expect(dto.birthDate).toBeUndefined();
  });

  it("rejects null name, birthDate and accessibilityNeed", async () => {
    const { fields } = await checkUpdate({ name: null, birthDate: null, accessibilityNeed: null });

    expect(fields).toEqual(["accessibilityNeed", "birthDate", "name"]);
    expect((await checkUpdate({ name: "   " })).fields).toEqual(["name"]);
    expect((await checkUpdate({ birthDate: "12/04/1958" })).fields).toEqual(["birthDate"]);
  });

  it("accepts null to clear optional fields", async () => {
    const { dto, errors } = await checkUpdate({
      email: null,
      phone: null,
      education: null,
      hasSmartphone: null,
      hasComputer: null,
      howFoundUs: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
      supportResource: null,
      classNeeds: null,
    });

    expect(errors).toHaveLength(0);
    expect(dto.phone).toBeNull();
    expect(dto.classNeeds).toBeNull();
    expect(dto.hasSmartphone).toBeNull();
  });
});
