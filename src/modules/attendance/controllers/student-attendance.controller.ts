import { Body, Controller, Param, ParseUUIDPipe, Patch } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { CurrentUser } from "@shared/decorators/current-user.decorator";
import { ApiErrorDto } from "@shared/dto/api-error.dto";
import { Permission } from "@shared/permissions/permission.enum";
import { RequirePermission } from "@shared/permissions/require-permission.decorator";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { CorrectStudentAttendanceDto } from "../dto/correct-student-attendance.dto";
import { JustifyAbsenceDto } from "../dto/justify-absence.dto";
import { StudentAttendanceResponseDto } from "../dto/student-attendance.response.dto";
import { studentAttendanceNotFound } from "../services/attendance-errors";
import { StudentAttendanceRecordsService } from "../services/student-attendance-records.service";

/** A malformed id is an attendance that does not exist, so it answers the same 404 as an unknown one. */
const STUDENT_ATTENDANCE_ID = new ParseUUIDPipe({
  exceptionFactory: () => studentAttendanceNotFound(),
});

const STUDENT_ATTENDANCE_ID_PARAM = {
  name: "id",
  format: "uuid",
  description: "Id of the attendance of the student (attendance.id of the roll call).",
};

const STUDENT_ATTENDANCE_NOT_FOUND_RESPONSE = {
  type: ApiErrorDto,
  description: "STUDENT_ATTENDANCE_NOT_FOUND",
};

/**
 * One signed attendance of a student (GUS-166): justify the absence and correct the status. The
 * roll call itself is `/lessons/:id/attendance/students`, another controller of this module.
 *
 * Justifying needs attendance.takeStudents, with the scope of the lesson of the attendance resolved
 * by the service (a member only where she is the confirmed teacher or a confirmed monitor).
 * Correcting needs attendance.correct, which only directors and coordination have, with the scope
 * all: the guard decides.
 */
@ApiTags("attendance")
@Controller("student-attendance")
@ApiStandardErrors()
export class StudentAttendanceController {
  constructor(private readonly recordsService: StudentAttendanceRecordsService) {}

  @Patch(":id/justify")
  @RequirePermission(Permission.ATTENDANCE_TAKE_STUDENTS)
  @ApiParam(STUDENT_ATTENDANCE_ID_PARAM)
  @ApiOkResponse({
    type: StudentAttendanceResponseDto,
    description:
      "The attendance after the commit, with the justification. The same reason and note again change nothing.",
  })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: "VALIDATION_FAILED" })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: "FORBIDDEN_SCOPE" })
  @ApiNotFoundResponse(STUDENT_ATTENDANCE_NOT_FOUND_RESPONSE)
  @ApiConflictResponse({
    type: ApiErrorDto,
    description: "LESSON_CANCELLED | CLASS_ARCHIVED | STUDENT_ATTENDANCE_NOT_ABSENT",
  })
  justifyAbsence(
    @Param("id", STUDENT_ATTENDANCE_ID) id: string,
    @Body() dto: JustifyAbsenceDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<StudentAttendanceResponseDto> {
    return this.recordsService.justify(id, dto, actor);
  }

  @Patch(":id/correct")
  @RequirePermission(Permission.ATTENDANCE_CORRECT)
  @ApiParam(STUDENT_ATTENDANCE_ID_PARAM)
  @ApiOkResponse({
    type: StudentAttendanceResponseDto,
    description: "The attendance after the commit, with the new correction last in corrections.",
  })
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description: "VALIDATION_FAILED | STUDENT_ATTENDANCE_STATUS_UNCHANGED",
  })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: "FORBIDDEN" })
  @ApiNotFoundResponse(STUDENT_ATTENDANCE_NOT_FOUND_RESPONSE)
  @ApiConflictResponse({ type: ApiErrorDto, description: "LESSON_CANCELLED | CLASS_ARCHIVED" })
  correctStudentAttendance(
    @Param("id", STUDENT_ATTENDANCE_ID) id: string,
    @Body() dto: CorrectStudentAttendanceDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<StudentAttendanceResponseDto> {
    return this.recordsService.correct(id, dto, actor);
  }
}
