import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate, ValidationError } from "class-validator";
import { ListMembersQueryDto } from "../dto/list-members-query.dto";
import { MemberStatus } from "../enums/member-status.enum";

function fieldsOf(errors: ValidationError[]): string[] {
  return errors.map((error) => error.property).sort();
}

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
