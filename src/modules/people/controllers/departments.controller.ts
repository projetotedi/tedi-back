import { Body, Controller, Get, Post } from "@nestjs/common";
import { ApiConflictResponse, ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { CurrentUser } from "@shared/decorators/current-user.decorator";
import { ApiErrorDto } from "@shared/dto/api-error.dto";
import { Permission } from "@shared/permissions/permission.enum";
import { RequirePermission } from "@shared/permissions/require-permission.decorator";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { CreateDepartmentDto } from "../dto/create-department.dto";
import { DepartmentResponseDto } from "../dto/department.response.dto";
import { DepartmentsService } from "../services/departments.service";

/**
 * DepartmentsController — the departments of the project, managed by coordination (GUS-91).
 *
 *  GET  /departments   — listDepartments    (ordered by name)
 *  POST /departments   — createDepartment
 *
 * Every route requires Permission.INVITES_MANAGE (coordinator): the coordination that
 * validates registrations is the one that keeps the list. Renaming and archiving are not
 * part of this card. The public sign-up form gets the list from GET /auth/invites/:token.
 */
@ApiTags("people")
@Controller("departments")
@ApiStandardErrors()
@RequirePermission(Permission.INVITES_MANAGE)
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  /** Lists every department, ordered by name. */
  @Get()
  @ApiOkResponse({ type: [DepartmentResponseDto] })
  listDepartments(): Promise<DepartmentResponseDto[]> {
    return this.departmentsService.list();
  }

  /** Creates a department. The same name in another case answers 409 DEPARTMENT_ALREADY_EXISTS. */
  @Post()
  @ApiCreatedResponse({ type: DepartmentResponseDto })
  @ApiConflictResponse({ type: ApiErrorDto, description: "DEPARTMENT_ALREADY_EXISTS" })
  createDepartment(
    @Body() dto: CreateDepartmentDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<DepartmentResponseDto> {
    return this.departmentsService.create(dto, actor.id);
  }
}
