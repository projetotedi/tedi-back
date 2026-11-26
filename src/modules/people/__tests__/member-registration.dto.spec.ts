import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate, ValidationError } from "class-validator";
import { todayInAppTimeZone } from "@shared/dates/calendar-date";
import { Role } from "@shared/enums/role.enum";
import { flattenValidationErrors } from "@shared/filters/http-exception.filter";
import { ApproveMemberRegistrationDto } from "../dto/approve-member-registration.dto";
import { CreateDepartmentDto } from "../dto/create-department.dto";
import { MemberRegistrationFormDto } from "../dto/member-registration-form.dto";
import { RejectMemberRegistrationDto } from "../dto/reject-member-registration.dto";

const DEPARTMENT_ID = "01999a3e-1111-7000-8000-000000000001";

const FULL_FORM = {
  name: "Ana Torres",
  ra: "a2210001",
  personalEmail: "ana.torres@example.com",
  birthDate: "1999-07-22",
  cpf: "529.982.247-25",
  phone: "(11) 98181-3030",
  address: "Rua das Acácias, 120, apto 42",
  city: "São Paulo",
  state: "SP",
  institutionalEmail: "ana.torres@example.edu",
  course: "Sistemas de Informação",
  semester: 7,
  className: "SI-2024-N",
  departmentId: DEPARTMENT_ID,
  volunteerTermUrl: "https://drive.google.com/file/d/exemplo/view",
};

const REQUIRED_FORM = {
  name: "Ana Torres",
  ra: "a2210001",
  personalEmail: "ana.torres@example.com",
  birthDate: "1999-07-22",
  cpf: "52998224725",
  phone: "11981813030",
  institutionalEmail: "ana.torres@example.edu",
  course: "Sistemas de Informação",
  semester: 7,
  className: "SI-2024-N",
};

const VALID_APPROVAL = {
  role: Role.MEMBER,
  departmentId: DEPARTMENT_ID,
  mainFunction: "Monitora de informática",
  joinedAt: "2026-10-01",
};

function fieldsOf(errors: ValidationError[]): string[] {
  return errors.map((error) => error.property).sort();
}

/** Next calendar day of a "YYYY-MM-DD" date, computed on the string (no local time zone). */
function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function checkForm(body: Record<string, unknown>) {
  const dto = plainToInstance(MemberRegistrationFormDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: fieldsOf(errors) };
}

async function checkApproval(body: Record<string, unknown>) {
  const dto = plainToInstance(ApproveMemberRegistrationDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: fieldsOf(errors) };
}

async function checkRejection(body: Record<string, unknown>) {
  const dto = plainToInstance(RejectMemberRegistrationDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: fieldsOf(errors) };
}

describe("MemberRegistrationFormDto", () => {
  it("accepts Ana Torres with every field", async () => {
    const { dto, errors } = await checkForm(FULL_FORM);

    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({
      name: "Ana Torres",
      birthDate: "1999-07-22",
      semester: 7,
      state: "SP",
      departmentId: DEPARTMENT_ID,
      volunteerTermUrl: "https://drive.google.com/file/d/exemplo/view",
    });
  });

  it("accepts only the required fields: address, city, state, departmentId and volunteerTermUrl are optional", async () => {
    const { dto, errors } = await checkForm(REQUIRED_FORM);

    expect(errors).toHaveLength(0);
    expect(dto.address).toBeUndefined();
    expect(dto.city).toBeUndefined();
    expect(dto.state).toBeUndefined();
    expect(dto.departmentId).toBeUndefined();
    expect(dto.volunteerTermUrl).toBeUndefined();

    // null and "" mean "not informed" for the optional text fields.
    const cleared = await checkForm({
      ...REQUIRED_FORM,
      address: "",
      city: "   ",
      state: null,
      departmentId: null,
      volunteerTermUrl: "",
    });
    expect(cleared.errors).toHaveLength(0);
    expect(cleared.dto.address).toBeNull();
    expect(cleared.dto.city).toBeNull();
    expect(cleared.dto.volunteerTermUrl).toBeNull();
  });

  it("reports each required field when missing: name, ra, personalEmail, birthDate, cpf, phone, institutionalEmail, course, semester, className", async () => {
    const { fields } = await checkForm({});

    expect(fields).toEqual(
      [
        "name",
        "ra",
        "personalEmail",
        "birthDate",
        "cpf",
        "phone",
        "institutionalEmail",
        "course",
        "semester",
        "className",
      ].sort(),
    );

    // Blank text counts as missing too.
    const blanks = await checkForm({
      ...REQUIRED_FORM,
      name: "  ",
      ra: " ",
      course: "",
      className: "",
    });
    expect(blanks.fields).toEqual(["className", "course", "name", "ra"]);
  });

  it("normalizes cpf and phone to digits and lower-cases ra, personalEmail and institutionalEmail", async () => {
    const { dto, errors } = await checkForm({
      ...REQUIRED_FORM,
      ra: "  A2210001 ",
      personalEmail: " Ana.Torres@Example.COM ",
      institutionalEmail: "ANA.TORRES@EXAMPLE.EDU",
      cpf: " 529.982.247-25 ",
      phone: "+55 (11) 98181-3030",
    });

    expect(errors).toHaveLength(0);
    expect(dto.ra).toBe("a2210001");
    expect(dto.personalEmail).toBe("ana.torres@example.com");
    expect(dto.institutionalEmail).toBe("ana.torres@example.edu");
    expect(dto.cpf).toBe("52998224725");
    expect(dto.phone).toBe("5511981813030");
  });

  it("reports phone with fewer than 10 or more than 13 digits", async () => {
    expect((await checkForm({ ...REQUIRED_FORM, phone: "1198181" })).fields).toEqual(["phone"]);
    expect((await checkForm({ ...REQUIRED_FORM, phone: "55119818130301" })).fields).toEqual([
      "phone",
    ]);
  });

  it("reports cpf for a wrong check digit or repeated digits", async () => {
    for (const cpf of ["529.982.247-24", "11111111111", "123", "5299822472a", ""]) {
      const { fields, errors } = await checkForm({ ...REQUIRED_FORM, cpf });
      expect(fields).toEqual(["cpf"]);
      // What the API answers (field + message) never echoes the value (RNF-14).
      expect(flattenValidationErrors(errors)).toEqual([
        { field: "cpf", message: "cpf must be a valid CPF" },
      ]);
    }
  });

  it("upper-cases state and reports it outside the 27 UFs", async () => {
    const lower = await checkForm({ ...REQUIRED_FORM, state: " sp " });
    expect(lower.errors).toHaveLength(0);
    expect(lower.dto.state).toBe("SP");

    for (const state of ["XX", "SPP", "S", 12]) {
      expect((await checkForm({ ...REQUIRED_FORM, state })).fields).toEqual(["state"]);
    }
  });

  it("reports semester outside 1 to 20 or not an integer", async () => {
    for (const semester of [0, 21, -1, 7.5, "7", null]) {
      expect((await checkForm({ ...REQUIRED_FORM, semester })).fields).toEqual(["semester"]);
    }
    for (const semester of [1, 20]) {
      expect((await checkForm({ ...REQUIRED_FORM, semester })).errors).toHaveLength(0);
    }
  });

  it("reports volunteerTermUrl when it is not an https URL", async () => {
    for (const volunteerTermUrl of [
      "http://drive.google.com/file/d/exemplo/view",
      "drive.google.com/file/d/exemplo/view",
      "not a url",
      "ftp://example.com/term.pdf",
      `https://example.com/${"a".repeat(500)}`,
    ]) {
      expect((await checkForm({ ...REQUIRED_FORM, volunteerTermUrl })).fields).toEqual([
        "volunteerTermUrl",
      ]);
    }
  });

  it("reports departmentId when it is not a uuid", async () => {
    for (const departmentId of ["tecnologia", "123", "01999a3e-1111-7000-8000", 42]) {
      expect((await checkForm({ ...REQUIRED_FORM, departmentId })).fields).toEqual([
        "departmentId",
      ]);
    }
  });

  it("reports birthDate in the future or in dd/mm/yyyy", async () => {
    const tomorrow = nextDay(todayInAppTimeZone());

    for (const birthDate of [tomorrow, "22/07/1999", "1999-7-22", "1899-12-31", "1999-02-30"]) {
      expect((await checkForm({ ...REQUIRED_FORM, birthDate })).fields).toEqual(["birthDate"]);
    }
  });

  it("reports text fields longer than the column", async () => {
    const { fields } = await checkForm({
      ...REQUIRED_FORM,
      name: "a".repeat(201),
      ra: "a".repeat(21),
      course: "a".repeat(101),
      className: "a".repeat(51),
      address: "a".repeat(201),
      city: "a".repeat(101),
    });

    expect(fields).toEqual(["address", "city", "className", "course", "name", "ra"]);
  });
});

describe("ApproveMemberRegistrationDto", () => {
  it("accepts role, departmentId, mainFunction, joinedAt and an optional note", async () => {
    const withoutNote = await checkApproval(VALID_APPROVAL);
    expect(withoutNote.errors).toHaveLength(0);
    expect(withoutNote.dto.note).toBeUndefined();

    const withNote = await checkApproval({ ...VALID_APPROVAL, note: "  Documentos conferidos. " });
    expect(withNote.errors).toHaveLength(0);
    expect(withNote.dto.note).toBe("Documentos conferidos.");

    const blankNote = await checkApproval({ ...VALID_APPROVAL, note: "   " });
    expect(blankNote.errors).toHaveLength(0);
    expect(blankNote.dto.note).toBeNull();

    expect((await checkApproval({ ...VALID_APPROVAL, note: "a".repeat(501) })).fields).toEqual([
      "note",
    ]);
  });

  it("requires departmentId for member and director but not for coordinator", async () => {
    const { departmentId: _omitted, ...withoutDepartment } = VALID_APPROVAL;

    for (const role of [Role.MEMBER, Role.DIRECTOR]) {
      expect((await checkApproval({ ...withoutDepartment, role })).fields).toEqual([
        "departmentId",
      ]);
      expect((await checkApproval({ ...VALID_APPROVAL, role, departmentId: null })).fields).toEqual(
        ["departmentId"],
      );
    }

    expect(
      (await checkApproval({ ...withoutDepartment, role: Role.COORDINATOR })).errors,
    ).toHaveLength(0);
    expect(
      (await checkApproval({ ...VALID_APPROVAL, role: Role.COORDINATOR, departmentId: null }))
        .errors,
    ).toHaveLength(0);
    // A coordinator may skip the department, but a department that is sent must be a uuid.
    expect(
      (await checkApproval({ ...VALID_APPROVAL, role: Role.COORDINATOR, departmentId: "abc" }))
        .fields,
    ).toEqual(["departmentId"]);
  });

  it("reports role when missing or unknown", async () => {
    const { role: _omitted, ...withoutRole } = VALID_APPROVAL;

    expect((await checkApproval(withoutRole)).fields).toEqual(["role"]);
    expect((await checkApproval({ ...VALID_APPROVAL, role: "owner" })).fields).toEqual(["role"]);
    // superadmin is a valid enum value: the service answers 400 INVALID_ROLE.
    expect((await checkApproval({ ...VALID_APPROVAL, role: Role.SUPERADMIN })).errors).toHaveLength(
      0,
    );
  });

  it("reports joinedAt in the future, before 2000-01-01 or in dd/mm/yyyy", async () => {
    const today = todayInAppTimeZone();

    for (const joinedAt of [
      nextDay(today),
      "1999-12-31",
      "01/10/2026",
      "2026-10-1",
      "2026-02-30",
      "",
    ]) {
      expect((await checkApproval({ ...VALID_APPROVAL, joinedAt })).fields).toEqual(["joinedAt"]);
    }
    for (const joinedAt of [today, "2000-01-01"]) {
      expect((await checkApproval({ ...VALID_APPROVAL, joinedAt })).errors).toHaveLength(0);
    }
  });

  it("reports mainFunction when blank or longer than 100", async () => {
    for (const mainFunction of ["", "   ", "a".repeat(101), undefined]) {
      expect((await checkApproval({ ...VALID_APPROVAL, mainFunction })).fields).toEqual([
        "mainFunction",
      ]);
    }
    expect(
      (await checkApproval({ ...VALID_APPROVAL, mainFunction: "a".repeat(100) })).errors,
    ).toHaveLength(0);
  });
});

describe("RejectMemberRegistrationDto", () => {
  it("accepts a note and trims it", async () => {
    const { dto, errors } = await checkRejection({ note: "  O RA não confere. " });

    expect(errors).toHaveLength(0);
    expect(dto.note).toBe("O RA não confere.");
  });

  it("reports note when missing or blank", async () => {
    for (const body of [{}, { note: "" }, { note: "   " }, { note: null }, { note: 12 }]) {
      expect((await checkRejection(body)).fields).toEqual(["note"]);
    }
  });

  it("reports a note longer than 500 characters", async () => {
    expect((await checkRejection({ note: "a".repeat(501) })).fields).toEqual(["note"]);
    expect((await checkRejection({ note: "a".repeat(500) })).errors).toHaveLength(0);
  });
});

describe("CreateDepartmentDto", () => {
  async function checkDepartment(body: Record<string, unknown>) {
    const dto = plainToInstance(CreateDepartmentDto, body);
    const errors = await validate(dto, { whitelist: true });
    return { dto, errors, fields: fieldsOf(errors) };
  }

  it("trims the name and reports it when blank or longer than 100", async () => {
    const valid = await checkDepartment({ name: "  Tecnologia " });
    expect(valid.errors).toHaveLength(0);
    expect(valid.dto.name).toBe("Tecnologia");

    for (const body of [{}, { name: "" }, { name: "   " }, { name: "a".repeat(101) }]) {
      expect((await checkDepartment(body)).fields).toEqual(["name"]);
    }
  });
});
