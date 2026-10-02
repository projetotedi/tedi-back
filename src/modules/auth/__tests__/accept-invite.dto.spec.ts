import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { MemberRegistrationFormDto } from "@modules/people/dto/member-registration-form.dto";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import { AcceptInviteDto } from "../dto/accept-invite.dto";

const REGISTRATION = {
  name: "Ana Torres",
  ra: " A2210001 ",
  personalEmail: "Ana.Torres@Example.com",
  birthDate: "1999-07-22",
  cpf: "529.982.247-25",
  phone: "(11) 98181-3030",
  institutionalEmail: "ana.torres@example.edu",
  course: "Sistemas de Informação",
  semester: 7,
  className: "SI-2024-N",
};

/** Runs the same pipe the app uses (main.ts) over a body, as the framework does for @Body(). */
async function pipe(body: Record<string, unknown>): Promise<AcceptInviteDto> {
  return (await buildValidationPipe().transform(body, {
    type: "body",
    metatype: AcceptInviteDto,
  })) as AcceptInviteDto;
}

async function fieldsOfFailure(body: Record<string, unknown>): Promise<string[]> {
  try {
    await pipe(body);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    const response = (error as BadRequestException).getResponse() as {
      error: string;
      rawErrors: Array<{ field: string }>;
    };
    expect(response.error).toBe("VALIDATION_FAILED");
    return response.rawErrors.map((e) => e.field).sort();
  }
  throw new Error("Expected the pipe to reject the body");
}

describe("AcceptInviteDto (through the global ValidationPipe)", () => {
  it("validates and normalizes the nested registration", async () => {
    const dto = await pipe({ token: "abc", password: "Senha@123", registration: REGISTRATION });

    expect(dto.registration).toBeInstanceOf(MemberRegistrationFormDto);
    expect(dto.registration).toMatchObject({
      ra: "a2210001",
      personalEmail: "ana.torres@example.com",
      cpf: "52998224725",
      phone: "11981813030",
    });
  });

  it("accepts a body without registration (password_reset); the service asks for it on access invites", async () => {
    const dto = await pipe({ token: "abc", password: "NovaSenh@456" });

    expect(dto.registration).toBeUndefined();
  });

  it("drops name, ra and email at the top level: they moved into registration", async () => {
    const dto = await pipe({
      token: "abc",
      password: "Senha@123",
      name: "Alice",
      ra: "a2210001",
      email: "alice@example.com",
    });

    expect(dto).not.toHaveProperty("name");
    expect(dto).not.toHaveProperty("ra");
    expect(dto).not.toHaveProperty("email");
    expect(dto.registration).toBeUndefined();
  });

  it("reports the nested fields in dot notation: registration.cpf and registration.state", async () => {
    const fields = await fieldsOfFailure({
      token: "abc",
      password: "Senha@123",
      registration: { ...REGISTRATION, cpf: "529.982.247-24", state: "XX" },
    });

    expect(fields).toEqual(["registration.cpf", "registration.state"]);
  });

  it("reports every missing required field of registration", async () => {
    const fields = await fieldsOfFailure({
      token: "abc",
      password: "Senha@123",
      registration: {},
    });

    expect(fields).toEqual(
      [
        "registration.name",
        "registration.ra",
        "registration.personalEmail",
        "registration.birthDate",
        "registration.cpf",
        "registration.phone",
        "registration.institutionalEmail",
        "registration.course",
        "registration.semester",
        "registration.className",
      ].sort(),
    );
  });

  it("reports registration that is not an object", async () => {
    expect(
      await fieldsOfFailure({ token: "abc", password: "Senha@123", registration: "Ana Torres" }),
    ).toEqual(["registration"]);
  });

  it("keeps the password rule: at least 8 characters", async () => {
    expect(
      await fieldsOfFailure({ token: "abc", password: "short", registration: REGISTRATION }),
    ).toEqual(["password"]);
  });
});
