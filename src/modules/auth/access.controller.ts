import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { ApiOkResponsePaginated } from "@shared/pagination/api-paginated-response.decorator";
import { Roles } from "@shared/decorators/roles.decorator";
import { CurrentUser } from "@shared/decorators/current-user.decorator";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { Role } from "@shared/enums/role.enum";
import { PaginatedResult } from "@shared/pagination/pagination.util";
import { AccessService } from "./services/access.service";
import { ListAccessQueryDto } from "./dto/list-access-query.dto";
import { UpdateAccessRoleDto } from "./dto/update-access-role.dto";
import { UpdateAccessEnabledDto } from "./dto/update-access-enabled.dto";
import { AccessResponseDto } from "./dto/access-response.dto";
import { PasswordResetResponseDto } from "./dto/password-reset-response.dto";

/**
 * AccessController — routes for access management.
 *
 * All routes require at minimum COORDINATOR role.
 *
 *  GET    /access                       — list people with access (paginated)
 *  PATCH  /access/:id/role             — change person's role
 *  PATCH  /access/:id/enabled          — enable/disable person's access
 *  POST   /access/:id/password-reset   — create password-reset invite
 */
@ApiTags("auth")
@Controller("access")
@ApiStandardErrors()
@Roles(Role.COORDINATOR)
export class AccessController {
  constructor(private readonly accessService: AccessService) {}

  /**
   * Lists people who have system access (role IS NOT NULL).
   * Supports pagination, search by name/RA, and filter by role and enabled.
   */
  @Get()
  @ApiOkResponsePaginated(AccessResponseDto)
  async listAccess(
    @Query() query: ListAccessQueryDto,
  ): Promise<PaginatedResult<AccessResponseDto>> {
    return this.accessService.listAccess(query);
  }

  /**
   * Changes the role of the given person.
   * SUPERADMIN cannot be assigned (400 INVALID_ROLE).
   * Cannot act on own account (403 OWN_ACCOUNT).
   * Coordinator cannot demote the last active coordinator (409 LAST_COORDINATOR).
   * Superadmin is exempt from LAST_COORDINATOR check.
   */
  @Patch(":id/role")
  @ApiOkResponse({ type: AccessResponseDto })
  async updateAccessRole(
    @Param("id") id: string,
    @Body() dto: UpdateAccessRoleDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<AccessResponseDto> {
    return this.accessService.updateRole(id, dto, actor.id, actor.role);
  }

  /**
   * Enables or disables a person's access.
   * Cannot act on own account (403 OWN_ACCOUNT).
   * Coordinator cannot disable the last active coordinator (409 LAST_COORDINATOR).
   * Superadmin is exempt from LAST_COORDINATOR check.
   */
  @Patch(":id/enabled")
  @ApiOkResponse({ type: AccessResponseDto })
  async updateAccessEnabled(
    @Param("id") id: string,
    @Body() dto: UpdateAccessEnabledDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<AccessResponseDto> {
    return this.accessService.updateEnabled(id, dto, actor.id, actor.role);
  }

  /**
   * Creates a password-reset invite for the given person.
   * Returns the reset URL and expiration time.
   * A coordinator may create a reset for their own account.
   */
  @Post(":id/password-reset")
  @HttpCode(201)
  @ApiCreatedResponse({ type: PasswordResetResponseDto })
  async createPasswordReset(
    @Param("id") id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<PasswordResetResponseDto> {
    return this.accessService.createPasswordReset(id, actor.id);
  }
}
