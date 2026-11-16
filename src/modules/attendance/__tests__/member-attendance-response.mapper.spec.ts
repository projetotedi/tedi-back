import { AssignmentRole } from "@modules/assignments/services/confirmed-staff.service";
import { MemberAttendance } from "../entities/member-attendance.entity";
import { MemberAttendanceStatus } from "../enums/member-attendance-status.enum";
import { toMemberAttendanceResponse } from "../services/member-attendance-response.mapper";

const ASSIGNMENT = {
  id: "01999a3e-7c1b-7000-8000-0000000000a2",
  personId: "01999a3e-0000-7000-8000-0000000000aa",
  role: AssignmentRole.MONITOR,
};
const TEACHER = { id: "01999a3e-0000-7000-8000-0000000000bb", name: "Bruno Teixeira" };
const MONITOR = { id: ASSIGNMENT.personId, name: "Ana Monteiro" };
const CONFIRMED_AT = new Date("2026-03-10T18:30:00.000Z");
const HOUR_ENTRY_ID = "01999a3e-7c1b-7000-8000-000000000a01";

describe("toMemberAttendanceResponse", () => {
  it("maps a signed row field by field, with the names of the member and of who signed", () => {
    const row = Object.assign(new MemberAttendance(), {
      id: "01999a3e-7c1b-7000-8000-0000000000d1",
      assignmentId: "01999a3e-7c1b-7000-8000-0000000000a9",
      lessonId: "01999a3e-7c1b-7000-8000-0000000000f1",
      personId: MONITOR.id,
      status: MemberAttendanceStatus.PRESENT,
      confirmedById: TEACHER.id,
      confirmedAt: CONFIRMED_AT,
      hourEntryId: HOUR_ENTRY_ID,
    });
    const peopleById = new Map([
      [MONITOR.id, MONITOR],
      [TEACHER.id, TEACHER],
    ]);

    expect(toMemberAttendanceResponse(ASSIGNMENT, row, peopleById)).toEqual({
      assignmentId: ASSIGNMENT.id,
      person: MONITOR,
      role: AssignmentRole.MONITOR,
      status: MemberAttendanceStatus.PRESENT,
      confirmedBy: TEACHER,
      confirmedAt: CONFIRMED_AT,
      hourEntryId: HOUR_ENTRY_ID,
    });
  });

  it("answers status, confirmedBy, confirmedAt and hourEntryId null for an unsigned assignment, and person null for a removed person", () => {
    expect(toMemberAttendanceResponse(ASSIGNMENT, null, new Map([[MONITOR.id, MONITOR]]))).toEqual({
      assignmentId: ASSIGNMENT.id,
      person: MONITOR,
      role: AssignmentRole.MONITOR,
      status: null,
      confirmedBy: null,
      confirmedAt: null,
      hourEntryId: null,
    });
    expect(toMemberAttendanceResponse(ASSIGNMENT, null, new Map()).person).toBeNull();
  });
});
