import {
  Body,
  Controller,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import {
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { CurrentUser } from "@shared/decorators/current-user.decorator";
import { ApiErrorDto } from "@shared/dto/api-error.dto";
import { ArchiveDto } from "@shared/dto/archive.dto";
import { Permission } from "@shared/permissions/permission.enum";
import { RequirePermission } from "@shared/permissions/require-permission.decorator";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { CreateStudentDto } from "../dto/create-student.dto";
import { StudentResponseDto } from "../dto/student.response.dto";
import { UpdateStudentDto } from "../dto/update-student.dto";
import { StudentsService } from "../services/students.service";

/**
 * A malformed id is a student that does not exist: same 404 as an unknown id.
 * Without the pipe, Postgres would reject the value and the answer would be a 500.
 */
const STUDENT_ID = new ParseUUIDPipe({
  exceptionFactory: () =>
    new NotFoundException({ error: "NOT_FOUND", message: "Student not found." }),
});

const STUDENT_ID_PARAM = { name: "id", format: "uuid", description: "Person id of the student." };

/**
 * StudentsController — student registration (GUS-105). Read routes come in GUS-106/107.
 *
 *  POST  /students                 — createStudent    (students.manage: director, coordinator)
 *  PATCH /students/:id             — updateStudent    (students.manage)
 *  PATCH /students/:id/archive     — archiveStudent   (students.archive: coordinator)
 *  PATCH /students/:id/unarchive   — unarchiveStudent (students.archive)
 *
 * :id is the Person id of the student. There is no DELETE: archive instead (RN-27).
 * The AuthGuard runs before the ValidationPipe, so a member gets 403 even with an invalid body.
 */
@ApiTags("people")
@Controller("students")
@ApiStandardErrors()
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  /** Registers a student. Name and birth date are required (RF-001). */
  @Post()
  @RequirePermission(Permission.STUDENTS_MANAGE)
  @ApiCreatedResponse({ type: StudentResponseDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: "EMAIL_ALREADY_IN_USE" })
  createStudent(
    @Body() dto: CreateStudentDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<StudentResponseDto> {
    return this.studentsService.create(dto, actor.id);
  }

  /**
   * Edits a student: omitted fields stay, null clears optional fields.
   * An archived student is read-only (409 STUDENT_ARCHIVED).
   */
  @Patch(":id")
  @RequirePermission(Permission.STUDENTS_MANAGE)
  @ApiParam(STUDENT_ID_PARAM)
  @ApiOkResponse({ type: StudentResponseDto })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description: "STUDENT_ARCHIVED | EMAIL_ALREADY_IN_USE",
  })
  updateStudent(
    @Param("id", STUDENT_ID) id: string,
    @Body() dto: UpdateStudentDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<StudentResponseDto> {
    return this.studentsService.update(id, dto, actor.id);
  }

  /**
   * Archives a student instead of deleting (RN-27). The first archive wins: archiving again
   * answers 200 without changes. From GUS-108 on, a student with an active enrollment
   * answers 409 STUDENT_HAS_ACTIVE_ENROLLMENTS.
   */
  @Patch(":id/archive")
  @RequirePermission(Permission.STUDENTS_ARCHIVE)
  @ApiParam(STUDENT_ID_PARAM)
  @ApiBody({ type: ArchiveDto, required: false })
  @ApiOkResponse({ type: StudentResponseDto })
  archiveStudent(
    @Param("id", STUDENT_ID) id: string,
    @Body() dto: ArchiveDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<StudentResponseDto> {
    return this.studentsService.archive(id, dto, actor.id);
  }

  /** Reactivates an archived student. A student that is not archived answers 200 unchanged. */
  @Patch(":id/unarchive")
  @RequirePermission(Permission.STUDENTS_ARCHIVE)
  @ApiParam(STUDENT_ID_PARAM)
  @ApiOkResponse({ type: StudentResponseDto })
  unarchiveStudent(
    @Param("id", STUDENT_ID) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<StudentResponseDto> {
    return this.studentsService.unarchive(id, actor.id);
  }
}
