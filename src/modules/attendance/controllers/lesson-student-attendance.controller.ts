import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from "@nestjs/common";
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
import { SignStudentAttendanceDto } from "../dto/sign-student-attendance.dto";
import { StudentRollCallItemResponseDto } from "../dto/student-roll-call-item.response.dto";
import { lessonNotFound } from "../services/attendance-errors";
import { StudentRollCallService } from "../services/student-roll-call.service";

/** A malformed id is a lesson that does not exist, so it answers the same 404 as an unknown one. */
const LESSON_ID = new ParseUUIDPipe({ exceptionFactory: () => lessonNotFound() });

const LESSON_ID_PARAM = { name: "id", format: "uuid", description: "Id of the lesson." };

const LESSON_NOT_FOUND_RESPONSE = { type: ApiErrorDto, description: "LESSON_NOT_FOUND" };

/**
 * The roll call of the students of a lesson (F6.1, GUS-166): the enrollments the lesson expects
 * (made before it ended and in force on its day), and whether each student was there.
 *
 * Reading needs lessons.view (every profile), as the attendance of the members; the justification
 * and the reasons of the corrections (they may be health data) go out only to whoever takes the roll
 * call of the lesson. Signing needs attendance.takeStudents, which every profile has; its scope is
 * resolved by the service, once per request: a member only in the lessons where she is the confirmed
 * teacher or a confirmed monitor, a director and coordination in every lesson. Justifying and
 * correcting one attendance are `/student-attendance/:id/...`, another controller of this module,
 * because the resource of the URL is the attendance.
 */
@ApiTags("attendance")
@Controller("lessons/:id/attendance/students")
@ApiStandardErrors()
export class LessonStudentAttendanceController {
  constructor(private readonly rollCallService: StudentRollCallService) {}

  @Get()
  @RequirePermission(Permission.LESSONS_VIEW)
  @ApiParam(LESSON_ID_PARAM)
  @ApiOkResponse({
    type: StudentRollCallItemResponseDto,
    isArray: true,
    description:
      "The roll call of the lesson, by the name of the student: the enrollments the lesson expects (made before it ended, and active from its day or before, or dropped or completed only after it), plus the ones already signed in it, with the status of each enrollment and the attendance (null while not signed). Not paginated.",
  })
  @ApiNotFoundResponse(LESSON_NOT_FOUND_RESPONSE)
  listStudentAttendance(
    @Param("id", LESSON_ID) lessonId: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<StudentRollCallItemResponseDto[]> {
    return this.rollCallService.list(lessonId, actor);
  }

  @Put()
  @RequirePermission(Permission.ATTENDANCE_TAKE_STUDENTS)
  @ApiParam(LESSON_ID_PARAM)
  @ApiOkResponse({
    type: StudentRollCallItemResponseDto,
    isArray: true,
    description:
      "The roll call of the lesson after the commit, the same list as the GET. All or none: any error writes nothing.",
  })
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description: "VALIDATION_FAILED | DUPLICATE_ENROLLMENT | ENROLLMENT_NOT_IN_ROLL_CALL",
  })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: "FORBIDDEN_SCOPE" })
  @ApiNotFoundResponse(LESSON_NOT_FOUND_RESPONSE)
  @ApiConflictResponse({
    type: ApiErrorDto,
    description:
      "LESSON_CANCELLED | LESSON_IN_FUTURE | CLASS_ARCHIVED | STUDENT_ATTENDANCE_ALREADY_SIGNED",
  })
  signStudentAttendance(
    @Param("id", LESSON_ID) lessonId: string,
    @Body() dto: SignStudentAttendanceDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<StudentRollCallItemResponseDto[]> {
    return this.rollCallService.sign(lessonId, dto, actor);
  }
}
