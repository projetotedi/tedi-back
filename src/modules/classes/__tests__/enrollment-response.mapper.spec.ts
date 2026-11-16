import { Enrollment } from "../entities/enrollment.entity";
import { EnrollmentStatus } from "../enums/enrollment-status.enum";
import { toEnrollmentResponse } from "../services/enrollment-response.mapper";

const ENROLLMENT_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const STUDENT_ID = "01999a3e-7c1b-7000-8000-000000000001";
const ENROLLED_AT = new Date("2026-03-03T13:00:00.000Z");

function buildEnrollment(overrides: Partial<Enrollment> = {}): Enrollment {
  return Object.assign(new Enrollment(), {
    id: ENROLLMENT_ID,
    classId: CLASS_ID,
    studentId: STUDENT_ID,
    status: EnrollmentStatus.DROPPED,
    enrolledAt: ENROLLED_AT,
    statusChangedAt: "2026-04-10",
    statusReason: "Mudou de cidade.",
    createdById: "01999a3e-0000-7000-8000-0000000000aa",
    createdAt: ENROLLED_AT,
    updatedAt: ENROLLED_AT,
    deletedAt: null,
    ...overrides,
  });
}

describe("enrollment response mapper", () => {
  it("projects the enrollment response without the internal columns", () => {
    // A field the caller happens to carry (the summary of people) never leaks into the answer.
    const student = { id: STUDENT_ID, name: "Maria Silva", archivedAt: null };
    const response = toEnrollmentResponse(buildEnrollment(), student);

    expect(response).toEqual({
      id: ENROLLMENT_ID,
      classId: CLASS_ID,
      student: { id: STUDENT_ID, name: "Maria Silva" },
      status: EnrollmentStatus.DROPPED,
      enrolledAt: ENROLLED_AT,
      statusChangedAt: "2026-04-10",
      statusReason: "Mudou de cidade.",
    });
  });
});
