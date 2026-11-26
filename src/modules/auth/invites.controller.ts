import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { Public } from "@shared/decorators/public.decorator";
import { RequirePermission } from "@shared/permissions/require-permission.decorator";
import { Permission } from "@shared/permissions/permission.enum";
import { CurrentUser } from "@shared/decorators/current-user.decorator";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { InvitesService } from "./services/invites.service";
import { CreateInviteDto } from "./dto/create-invite.dto";
import { CreateInviteResponseDto } from "./dto/create-invite-response.dto";
import { AcceptInviteDto } from "./dto/accept-invite.dto";
import { InviteResponseDto } from "./dto/invite-response.dto";
import { InviteListItemDto } from "./dto/invite-list-item.dto";
import { ListInvitesQueryDto } from "./dto/list-invites-query.dto";

/**
 * InvitesController — routes for invite lifecycle.
 *
 * No controller-level @Controller prefix so routes can span two different
 * path prefixes (/invites and /auth/invites) without nesting modules.
 *
 *  POST   /invites               — create invite (Permission.INVITES_MANAGE: coordinator only)
 *  GET    /invites               — list invites (Permission.INVITES_MANAGE: coordinator only)
 *  GET    /auth/invites/:token   — inspect invite without consuming it (public)
 *  POST   /auth/invites/accept   — accept invite: access → pending member registration;
 *                                  password_reset → new password (public)
 *  DELETE /invites/:id           — revoke invite (Permission.INVITES_MANAGE: coordinator only)
 */
@ApiTags("auth")
@Controller()
@ApiStandardErrors()
export class InvitesController {
  constructor(
    private readonly invitesService: InvitesService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Creates an ACCESS invite for the given role.
   * Returns 201 with the invite metadata and the one-time token URL.
   * Only COORDINATOR (and SUPERADMIN) can create invites.
   */
  @Post("invites")
  @RequirePermission(Permission.INVITES_MANAGE)
  @ApiCreatedResponse({ type: CreateInviteResponseDto })
  async createInvite(
    @Body() dto: CreateInviteDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<CreateInviteResponseDto> {
    const { invite, token } = await this.invitesService.create(dto, actor.id);
    const appUrl = this.config.getOrThrow<string>("APP_URL");

    return {
      id: invite.id,
      role: invite.role,
      expiresAt: invite.expiresAt,
      url: `${appUrl}/invite?token=${token}`,
    };
  }

  /**
   * Lists all invites, optionally filtered by computed status.
   * Never exposes tokenHash.
   */
  @Get("invites")
  @RequirePermission(Permission.INVITES_MANAGE)
  @ApiOkResponse({ type: [InviteListItemDto] })
  async listInvites(@Query() query: ListInvitesQueryDto): Promise<InviteListItemDto[]> {
    return this.invitesService.list(query.status);
  }

  /**
   * Returns invite metadata for the given raw token.
   * Does NOT consume the invite (usedAt remains null).
   * Public — called by the front-end invite acceptance page before the user
   * fills in their registration form.
   * `person` (name and RA only) is returned for password_reset invites and is
   * always null for access invites. `departments` is the list the sign-up form offers
   * (access invites; [] for password_reset).
   */
  @Get("auth/invites/:token")
  @Public()
  @ApiOkResponse({ type: InviteResponseDto })
  async getInvite(@Param("token") token: string): Promise<InviteResponseDto> {
    return this.invitesService.getPublicView(token);
  }

  /**
   * Accepts an invite. Returns 204 No Content on success. Public — no authentication required.
   *  - access → creates the member registration as "A validar" (GUS-91): the Person gets no
   *    access until coordination approves it. Requires `registration`.
   *  - password_reset → sets the new password. Ignores `registration`.
   * 400 INVALID_INVITE, 400 VALIDATION_FAILED (registration.*), 400 DEPARTMENT_NOT_FOUND,
   * 409 RA_ALREADY_IN_USE, 409 EMAIL_ALREADY_IN_USE. On errors the invite is not consumed.
   */
  @Post("auth/invites/accept")
  @Public()
  @HttpCode(204)
  @ApiNoContentResponse({
    description:
      "Invite accepted. Access invite: member registration created as pending, without access.",
  })
  async acceptInvite(@Body() dto: AcceptInviteDto): Promise<void> {
    await this.invitesService.accept(dto);
  }

  /**
   * Revokes a pending invite.
   * Returns 204 No Content on success.
   * 409 INVITE_ALREADY_USED if already used.
   * 409 INVITE_ALREADY_REVOKED if already revoked.
   */
  @Delete("invites/:id")
  @RequirePermission(Permission.INVITES_MANAGE)
  @HttpCode(204)
  @ApiNoContentResponse({ description: "Invite revoked." })
  async revokeInvite(@Param("id") id: string, @CurrentUser() actor: AuthUser): Promise<void> {
    await this.invitesService.revoke(id, actor.id);
  }
}
