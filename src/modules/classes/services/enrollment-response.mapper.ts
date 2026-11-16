import { EnrollmentResponseDto } from "../dto/enrollment.response.dto";
import { Enrollment } from "../entities/enrollment.entity";

/** Who the student of an enrollment is, as the writes answer it. */
export interface EnrollmentStudentRef {
  id: string;
  name: string;
}

/**
 * The enrollment as the writes answer it. Explicit projection: no internal column (createdById,
 * the timestamps of the row) reaches the response by accident.
 */
export function toEnrollmentResponse(
  enrollment: Enrollment,
  student: EnrollmentStudentRef,
): EnrollmentResponseDto {
  return {
    id: enrollment.id,
    classId: enrollment.classId,
    student: { id: student.id, name: student.name },
    status: enrollment.status,
    enrolledAt: enrollment.enrolledAt,
    statusChangedAt: enrollment.statusChangedAt,
    statusReason: enrollment.statusReason,
  };
}
