import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { flattenValidationErrors } from "@shared/filters/http-exception.filter";
import { MEMBER_ATTENDANCE_MAX_ENTRIES } from "../dto/attendance-limits";
import { ConfirmMemberAttendanceDto } from "../dto/confirm-member-attendance.dto";
import { MemberAttendanceStatus } from "../enums/member-attendance-status.enum";

const ASSIGNMENT_ID = "01999a3e-7c1b-7000-8000-0000000000a1";

async function check(body: Record<string, unknown>) {
  const dto = plainToInstance(ConfirmMemberAttendanceDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: flattenValidationErrors(errors).map((error) => error.field) };
}

function entries(count: number): Array<{ assignmentId: string; status: string }> {
  return Array.from({ length: count }, (_, index) => ({
    assignmentId: `01999a3e-7c1b-7000-8000-${String(index).padStart(12, "0")}`,
    status: index % 2 === 0 ? "present" : "absent",
  }));
}

describe("ConfirmMemberAttendanceDto", () => {
  it("accepts from 1 to 100 entries with a uuid and present or absent", async () => {
    for (const count of [1, MEMBER_ATTENDANCE_MAX_ENTRIES]) {
      const { errors } = await check({ entries: entries(count) });
      expect(errors).toHaveLength(0);
    }

    const { dto } = await check({
      entries: [{ assignmentId: ASSIGNMENT_ID.toUpperCase(), status: "absent" }],
    });
    expect(dto.entries[0]).toEqual({
      assignmentId: ASSIGNMENT_ID.toUpperCase(),
      status: MemberAttendanceStatus.ABSENT,
    });
  });

  it("rejects an empty list, more than 100 entries, a malformed assignmentId and an unknown status, on entries.<i>.<field>", async () => {
    expect((await check({ entries: [] })).fields).toEqual(["entries"]);
    expect((await check({ entries: entries(MEMBER_ATTENDANCE_MAX_ENTRIES + 1) })).fields).toEqual([
      "entries",
    ]);
    expect((await check({})).fields).toEqual(["entries"]);
    expect(
      (
        await check({
          entries: [
            { assignmentId: ASSIGNMENT_ID, status: "present" },
            { assignmentId: "not-a-uuid", status: "late" },
          ],
        })
      ).fields.sort(),
    ).toEqual(["entries.1.assignmentId", "entries.1.status"]);
  });

  it("drops the fields the body does not declare", async () => {
    const { dto, errors } = await check({
      entries: [{ assignmentId: ASSIGNMENT_ID, status: "present", hourEntryId: "x" }],
      lessonId: "x",
    });

    expect(errors).toHaveLength(0);
    expect(dto).not.toHaveProperty("lessonId");
    expect(dto.entries[0]).not.toHaveProperty("hourEntryId");
  });
});
