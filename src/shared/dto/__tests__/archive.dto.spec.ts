import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ArchiveDto } from "../archive.dto";

async function check(body: unknown) {
  const dto = plainToInstance(ArchiveDto, body);
  const errors = await validate(dto);
  return { dto, errors };
}

describe("ArchiveDto", () => {
  it("accepts an empty body and a missing reason", async () => {
    const empty = await check({});
    expect(empty.errors).toHaveLength(0);
    expect(empty.dto.reason).toBeUndefined();

    const withReason = await check({ reason: "  Mudou de cidade.  " });
    expect(withReason.errors).toHaveLength(0);
    expect(withReason.dto.reason).toBe("Mudou de cidade.");
  });

  it("turns a blank reason into null", async () => {
    const { dto, errors } = await check({ reason: "   " });

    expect(errors).toHaveLength(0);
    expect(dto.reason).toBeNull();
  });

  it("rejects a reason longer than 500 characters", async () => {
    const { errors } = await check({ reason: "a".repeat(501) });

    expect(errors.map((error) => error.property)).toEqual(["reason"]);

    const atLimit = await check({ reason: "a".repeat(500) });
    expect(atLimit.errors).toHaveLength(0);
  });
});
