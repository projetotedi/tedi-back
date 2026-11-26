import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";
import { ChangePasswordDto } from "../dto/change-password.dto";

/** Runs the same pipe the app uses (main.ts) over a body, as the framework does for @Body(). */
async function pipe(body: Record<string, unknown>): Promise<ChangePasswordDto> {
  return (await buildValidationPipe().transform(body, {
    type: "body",
    metatype: ChangePasswordDto,
  })) as ChangePasswordDto;
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
    return response.rawErrors.map((e) => e.field);
  }
  throw new Error("Expected the pipe to reject the body");
}

describe("ChangePasswordDto (through the global ValidationPipe)", () => {
  it("accepts a new password with 8 characters or more", async () => {
    const dto = await pipe({ newPassword: "NovaSenha@123" });

    expect(dto).toBeInstanceOf(ChangePasswordDto);
    expect(dto.newPassword).toBe("NovaSenha@123");
  });

  it("keeps the password as typed, without trimming it", async () => {
    const dto = await pipe({ newPassword: "  espacos nas pontas  " });

    expect(dto.newPassword).toBe("  espacos nas pontas  ");
  });

  it("rejects a password with fewer than 8 characters", async () => {
    expect(await fieldsOfFailure({ newPassword: "curta" })).toEqual(["newPassword"]);
  });

  it("rejects a missing newPassword", async () => {
    expect(await fieldsOfFailure({})).toEqual(["newPassword"]);
  });

  it("rejects a newPassword that is not a string", async () => {
    expect(await fieldsOfFailure({ newPassword: 12345678 })).toEqual(["newPassword"]);
  });

  it("drops every other field: the body carries only the new password", async () => {
    const dto = await pipe({
      newPassword: "NovaSenha@123",
      currentPassword: "SenhaAntiga@1",
      mustChangePassword: false,
      passwordHash: "x",
    });

    expect(dto).toEqual({ newPassword: "NovaSenha@123" });
  });
});
