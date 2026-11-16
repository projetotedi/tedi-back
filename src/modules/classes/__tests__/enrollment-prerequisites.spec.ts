import { EnrollmentWarningCode } from "../enums/enrollment-warning-code.enum";
import { missingPrerequisites } from "../services/enrollment-prerequisites";

const ANA = "01999a3e-7c1b-7000-8000-000000000001";
const BRUNO = "01999a3e-7c1b-7000-8000-000000000002";
const BASIC = { id: "01999a3e-7c1b-7000-8000-0000000000b1", name: "Informática Básica" };
const SMARTPHONES = { id: "01999a3e-7c1b-7000-8000-0000000000b2", name: "Smartphones" };

describe("missingPrerequisites", () => {
  it("answers no warning when the course has no prerequisite", () => {
    expect(missingPrerequisites([ANA, BRUNO], [], [])).toEqual([]);
  });

  it("warns once per student and missing prerequisite, in the order of the students and then the name of the course", () => {
    // BRUNO comes first in the body; the prerequisites come by name from the catalog.
    expect(missingPrerequisites([BRUNO, ANA], [BASIC, SMARTPHONES], [])).toEqual([
      {
        studentId: BRUNO,
        code: EnrollmentWarningCode.PREREQUISITE_NOT_COMPLETED,
        courseId: BASIC.id,
        courseName: "Informática Básica",
      },
      {
        studentId: BRUNO,
        code: EnrollmentWarningCode.PREREQUISITE_NOT_COMPLETED,
        courseId: SMARTPHONES.id,
        courseName: "Smartphones",
      },
      {
        studentId: ANA,
        code: EnrollmentWarningCode.PREREQUISITE_NOT_COMPLETED,
        courseId: BASIC.id,
        courseName: "Informática Básica",
      },
      {
        studentId: ANA,
        code: EnrollmentWarningCode.PREREQUISITE_NOT_COMPLETED,
        courseId: SMARTPHONES.id,
        courseName: "Smartphones",
      },
    ]);
  });

  it("does not warn for a prerequisite the student completed", () => {
    const warnings = missingPrerequisites(
      [ANA, BRUNO],
      [BASIC, SMARTPHONES],
      [
        { studentId: ANA, courseId: BASIC.id },
        { studentId: ANA, courseId: SMARTPHONES.id },
        { studentId: BRUNO, courseId: SMARTPHONES.id },
      ],
    );

    expect(warnings.map((warning) => [warning.studentId, warning.courseId])).toEqual([
      [BRUNO, BASIC.id],
    ]);
  });
});
