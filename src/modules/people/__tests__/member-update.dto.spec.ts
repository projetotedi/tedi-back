import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate, ValidationError } from "class-validator";
import { todayInAppTimeZone } from "@shared/dates/calendar-date";
import { flattenValidationErrors } from "@shared/filters/http-exception.filter";
import { UpdateMemberDto } from "../dto/update-member.dto";

const DEPARTMENT_ID = "01999a3e-1111-7000-8000-000000000002";

const NEVER_NULL_FIELDS = [
  "name",
  "ra",
  "email",
  "birthDate",
  "cpf",
  "phone",
  "institutionalEmail",
  "course",
  "semester",
  "className",
  "departmentId",
  "mainFunction",
  "joinedAt",
];

const NEVER_NULL_TEXT_FIELDS = [
  "name",
  "ra",
  "email",
  "cpf",
  "phone",
  "institutionalEmail",
  "course",
  "className",
  "departmentId",
  "mainFunction",
];

function fieldsOf(errors: ValidationError[]): string[] {
  return errors.map((error) => error.property).sort();
}

/** Next calendar day of a "YYYY-MM-DD" date, computed on the string (no local time zone). */
function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Same steps as the global ValidationPipe: plainToInstance, then validate with the whitelist. */
async function checkUpdate(body: Record<string, unknown>) {
  const dto = plainToInstance(UpdateMemberDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: fieldsOf(errors) };
}

describe("UpdateMemberDto", () => {
  it("accepts an empty body: every field is optional", async () => {
    const { dto, errors } = await checkUpdate({});

    expect(errors).toHaveLength(0);
    expect(dto.email).toBeUndefined();
    expect(dto.departmentId).toBeUndefined();
    expect(dto.name).toBeUndefined();
  });

  it("accepts every field of the modal and normalizes them like the sign-up: cpf and phone to digits, ra and e-mails lower-cased, state upper-cased, departmentId lower-cased, texts trimmed", async () => {
    const { dto, errors } = await checkUpdate({
      name: "  Ana T. ",
      ra: " A2219999 ",
      email: " Ana@Example.ORG ",
      birthDate: "1999-07-22",
      cpf: "111.444.777-35",
      phone: "(41) 99999-0000",
      address: " Rua das Araucárias, 10 ",
      city: " Curitiba ",
      state: " pr ",
      institutionalEmail: " ANA@UTFPR.EDU.BR ",
      course: " Engenharia de Software ",
      semester: 8,
      className: " ES-2025 ",
      departmentId: DEPARTMENT_ID.toUpperCase(),
      mainFunction: " Professora ",
      joinedAt: "2026-02-01",
      volunteerTermUrl: " https://drive.google.com/file/d/novo/view ",
    });

    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({
      name: "Ana T.",
      ra: "a2219999",
      email: "ana@example.org",
      birthDate: "1999-07-22",
      cpf: "11144477735",
      phone: "41999990000",
      address: "Rua das Araucárias, 10",
      city: "Curitiba",
      state: "PR",
      institutionalEmail: "ana@utfpr.edu.br",
      course: "Engenharia de Software",
      semester: 8,
      className: "ES-2025",
      departmentId: DEPARTMENT_ID,
      mainFunction: "Professora",
      joinedAt: "2026-02-01",
      volunteerTermUrl: "https://drive.google.com/file/d/novo/view",
    });
  });

  it("reports null on every never-null field: name, ra, email, birthDate, cpf, phone, institutionalEmail, course, semester, className, departmentId, mainFunction, joinedAt", async () => {
    for (const field of NEVER_NULL_FIELDS) {
      expect((await checkUpdate({ [field]: null })).fields).toEqual([field]);
    }
  });

  it("reports a blank never-null text field, which the trims turn into null or empty", async () => {
    for (const field of NEVER_NULL_TEXT_FIELDS) {
      expect((await checkUpdate({ [field]: "   " })).fields).toEqual([field]);
    }
  });

  it("accepts null and blank to clear address, city, state and volunteerTermUrl", async () => {
    for (const cleared of [null, "", "   "]) {
      const { dto, errors } = await checkUpdate({
        address: cleared,
        city: cleared,
        state: cleared,
        volunteerTermUrl: cleared,
      });

      expect(errors).toHaveLength(0);
      expect(dto).toMatchObject({
        address: null,
        city: null,
        state: null,
        volunteerTermUrl: null,
      });
    }
  });

  it("drops role, accessEnabled, status, exitDate, registrationStatus and personalEmail (whitelist)", async () => {
    const { dto, errors } = await checkUpdate({
      name: "Ana T.",
      role: "coordinator",
      accessEnabled: false,
      status: "inactive",
      exitDate: "2026-01-01",
      registrationStatus: "pending",
      personalEmail: "outra@example.com",
    });

    expect(errors).toHaveLength(0);
    expect(dto.name).toBe("Ana T.");
    for (const key of [
      "role",
      "accessEnabled",
      "status",
      "exitDate",
      "registrationStatus",
      "personalEmail",
    ]) {
      expect(dto).not.toHaveProperty(key);
    }
  });

  it("reuses the validators of the sign-up and of the approval: invalid CPF, phone with letters, unknown UF, future joinedAt, http term link, semester out of range", async () => {
    const { errors } = await checkUpdate({
      cpf: "123.456.789-00",
      phone: "(11) 9abc1-3030",
      state: "XX",
      joinedAt: nextDay(todayInAppTimeZone()),
      volunteerTermUrl: "http://drive.google.com/file/d/exemplo/view",
      semester: 21,
    });

    expect(
      flattenValidationErrors(errors)
        .map((error) => error.field)
        .sort(),
    ).toEqual(["cpf", "joinedAt", "phone", "semester", "state", "volunteerTermUrl"]);
  });

  it("reports text fields longer than the column", async () => {
    const domain = `${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.${"e".repeat(10)}.com`;
    const longEmail = `ana@${domain}`;
    expect(longEmail).toHaveLength(201);

    const { errors, fields } = await checkUpdate({
      name: "a".repeat(201),
      ra: "a".repeat(21),
      email: longEmail,
      address: "a".repeat(201),
      city: "a".repeat(101),
      course: "a".repeat(101),
      className: "a".repeat(51),
      mainFunction: "a".repeat(101),
      volunteerTermUrl: `https://drive.google.com/${"a".repeat(476)}`,
    });

    expect(fields).toEqual(
      [
        "name",
        "ra",
        "email",
        "address",
        "city",
        "course",
        "className",
        "mainFunction",
        "volunteerTermUrl",
      ].sort(),
    );
    for (const error of errors) {
      expect(Object.keys(error.constraints ?? {})).toEqual(["maxLength"]);
    }
  });
});
