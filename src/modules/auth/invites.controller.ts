import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { Public } from "@shared/decorators/public.decorator";
import { Roles } from "@shared/decorators/roles.decorator";
import { CurrentUser } from "@shared/decorators/current-user.decorator";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { Role } from "@shared/enums/role.enum";
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
 *  POST   /invites               — create invite (COORDINATOR only)
 *  GET    /invites               — list invites (COORDINATOR only)
 *  GET    /auth/invites/:token   — inspect invite without consuming it (public)
 *  POST   /auth/invites/accept   — accept invite and provision Person (public)
 *  DELETE /invites/:id           — revoke invite (COORDINATOR only)
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
  @Roles(Role.COORDINATOR)
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
  @Roles(Role.COORDINATOR)
  @ApiOkResponse({ type: [InviteListItemDto] })
  async listInvites(@Query() query: ListInvitesQueryDto): Promise<InviteListItemDto[]> {
    return this.invitesService.list(query.status);
  }

  /**
   * Returns invite metadata for the given raw token.
   * Does NOT consume the invite (usedAt remains null).
   * Public — called by the front-end invite acceptance page before the user
   * fills in their registration form.
   */
  @Get("auth/invites/:token")
  @Public()
  @ApiOkResponse({ type: InviteResponseDto })
  async getInvite(@Param("token") token: string): Promise<InviteResponseDto> {
    const invite = await this.invitesService.getByToken(token);

    return {
      type: invite.type,
      role: invite.role,
      expiresAt: invite.expiresAt,
    };
  }

  /**
   * Accepts an invite and provisions a Person.
   * Returns 204 No Content on success.
   * Public — no authentication required.
   */
  @Post("auth/invites/accept")
  @Public()
  @HttpCode(204)
  @ApiNoContentResponse({ description: "Invite accepted. Person account provisioned." })
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
  @Roles(Role.COORDINATOR)
  @HttpCode(204)
  @ApiNoContentResponse({ description: "Invite revoked." })
  async revokeInvite(@Param("id") id: string, @CurrentUser() actor: AuthUser): Promise<void> {
    await this.invitesService.revoke(id, actor.id);
  }
}
