import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate, ValidationError } from "class-validator";
import { flattenValidationErrors } from "@shared/filters/http-exception.filter";
import { ASSIGNMENT_NOTE_MAX_LENGTH } from "../dto/assignment-limits";
import { CreateAssignmentDto } from "../dto/create-assignment.dto";
import { AssignmentRole } from "../enums/assignment-role.enum";
import { AssignmentStatus } from "../enums/assignment-status.enum";

const PERSON_ID = "01999a3e-0000-7000-8000-0000000000b1";

const VALID_BODY = {
  personId: PERSON_ID,
  role: "monitor",
  status: "pending",
};

function fieldsOf(errors: ValidationError[]): string[] {
  return errors.map((error) => error.property).sort();
}

function messagesOf(errors: ValidationError[]): string[] {
  return flattenValidationErrors(errors)
    .map((error) => error.message)
    .sort();
}

async function check(body: Record<string, unknown>) {
  const dto = plainToInstance(CreateAssignmentDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: fieldsOf(errors) };
}

describe("CreateAssignmentDto", () => {
  it("accepts a member, a role and a status, and nothing else", async () => {
    const { dto, errors } = await check(VALID_BODY);

    expect(errors).toHaveLength(0);
    expect(dto.personId).toBe(PERSON_ID);
    expect(dto.role).toBe(AssignmentRole.MONITOR);
    expect(dto.status).toBe(AssignmentStatus.PENDING);
    expect(dto.note).toBeUndefined();
  });

  it.each(Object.values(AssignmentRole))("accepts the role %s", async (role) => {
    const { errors } = await check({ ...VALID_BODY, role });

    expect(errors).toHaveLength(0);
  });

  it.each(["pending", "confirmed"])("accepts the status %s", async (status) => {
    const { dto, errors } = await check({ ...VALID_BODY, status });

    expect(errors).toHaveLength(0);
    expect(dto.status).toBe(status);
  });

  it.each(["declined", "cancelled"])(
    "refuses the status %s: it only comes from a decision about an assignment that exists",
    async (status) => {
      const { fields, errors } = await check({ ...VALID_BODY, status });

      expect(fields).toEqual(["status"]);
      expect(messagesOf(errors)).toEqual([expect.stringContaining("status must be one of")]);
    },
  );

  it("refuses a status outside the enum, a status that is not text and a null status", async () => {
    for (const status of ["open", "PENDING", 1, true, null, {}]) {
      const { fields } = await check({ ...VALID_BODY, status });

      expect(fields).toEqual(["status"]);
    }
  });

  it("requires the status: there is no default, so the body says whether it is confirmed", async () => {
    const { status: _status, ...withoutStatus } = VALID_BODY;

    const { fields } = await check(withoutStatus);

    expect(fields).toEqual(["status"]);
  });

  it("requires the member and the role", async () => {
    const { personId: _personId, role: _role, ...onlyStatus } = VALID_BODY;

    const { fields } = await check(onlyStatus);

    expect(fields).toEqual(["personId", "role"]);
    expect((await check({})).fields).toEqual(["personId", "role", "status"]);
  });

  it("refuses a personId that is not a UUID", async () => {
    for (const personId of ["", "not-a-uuid", "01999a3e-0000-7000-8000", 42, null, {}]) {
      const { fields } = await check({ ...VALID_BODY, personId });

      expect(fields).toEqual(["personId"]);
    }
  });

  it("accepts a UUID of any version and in upper case", async () => {
    for (const personId of [
      PERSON_ID,
      PERSON_ID.toUpperCase(),
      "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    ]) {
      const { errors } = await check({ ...VALID_BODY, personId });

      expect(errors).toHaveLength(0);
    }
  });

  it("refuses a role that is not teacher or monitor", async () => {
    for (const role of ["student", "Teacher", "", 1, null]) {
      const { fields } = await check({ ...VALID_BODY, role });

      expect(fields).toEqual(["role"]);
    }
  });

  describe("note", () => {
    it("trims the note", async () => {
      const { dto, errors } = await check({ ...VALID_BODY, note: "  Cobre a segunda hora.  " });

      expect(errors).toHaveLength(0);
      expect(dto.note).toBe("Cobre a segunda hora.");
    });

    it("turns a blank note into null, and keeps a null one", async () => {
      expect((await check({ ...VALID_BODY, note: "   " })).dto.note).toBeNull();
      expect((await check({ ...VALID_BODY, note: "" })).dto.note).toBeNull();
      expect((await check({ ...VALID_BODY, note: null })).errors).toHaveLength(0);
    });

    it("accepts a note of exactly the limit and refuses one character more", async () => {
      const atTheLimit = await check({
        ...VALID_BODY,
        note: "x".repeat(ASSIGNMENT_NOTE_MAX_LENGTH),
      });
      const over = await check({ ...VALID_BODY, note: "x".repeat(ASSIGNMENT_NOTE_MAX_LENGTH + 1) });

      expect(ASSIGNMENT_NOTE_MAX_LENGTH).toBe(500);
      expect(atTheLimit.errors).toHaveLength(0);
      expect(over.fields).toEqual(["note"]);
    });

    it("measures the limit after trimming: spaces around a note at the limit do not count", async () => {
      const { errors } = await check({
        ...VALID_BODY,
        note: `  ${"x".repeat(ASSIGNMENT_NOTE_MAX_LENGTH)}  `,
      });

      expect(errors).toHaveLength(0);
    });

    it("refuses a note that is not text", async () => {
      for (const note of [1, true, {}, ["a"]]) {
        const { fields } = await check({ ...VALID_BODY, note });

        expect(fields).toEqual(["note"]);
      }
    });
  });

  it("does not declare source: the whitelist drops it, so an assignment made here is always direct", async () => {
    const dto = plainToInstance(CreateAssignmentDto, { ...VALID_BODY, source: "application" });
    const errors = await validate(dto, { whitelist: true });

    expect(errors).toHaveLength(0);
    expect(dto).not.toHaveProperty("source");
  });

  it("drops the fields that are not its own: the lesson is the one of the URL", async () => {
    const dto = plainToInstance(CreateAssignmentDto, {
      ...VALID_BODY,
      lessonId: "01999a3e-7c1b-7000-8000-0000000000f1",
      reviewedById: PERSON_ID,
      createdById: PERSON_ID,
    });
    await validate(dto, { whitelist: true });

    expect(dto).not.toHaveProperty("lessonId");
    expect(dto).not.toHaveProperty("reviewedById");
    expect(dto).not.toHaveProperty("createdById");
  });
});
