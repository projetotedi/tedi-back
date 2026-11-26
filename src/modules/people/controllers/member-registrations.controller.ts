import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from "@nestjs/common";
import {
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { CurrentUser } from "@shared/decorators/current-user.decorator";
import { ApiErrorDto } from "@shared/dto/api-error.dto";
import { ApiOkResponsePaginated } from "@shared/pagination/api-paginated-response.decorator";
import { PaginatedResult } from "@shared/pagination/pagination.util";
import { Permission } from "@shared/permissions/permission.enum";
import { RequirePermission } from "@shared/permissions/require-permission.decorator";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { ApproveMemberRegistrationDto } from "../dto/approve-member-registration.dto";
import { ListMemberRegistrationsQueryDto } from "../dto/list-member-registrations-query.dto";
import { MemberRegistrationListItemDto } from "../dto/member-registration-list-item.dto";
import { MemberRegistrationResponseDto } from "../dto/member-registration.response.dto";
import { RejectMemberRegistrationDto } from "../dto/reject-member-registration.dto";
import { MembersService, memberRegistrationNotFound } from "../services/members.service";

/**
 * A malformed id is a registration that does not exist: same 404 as an unknown id.
 * Without the pipe, Postgres would reject the value and the answer would be a 500.
 */
const REGISTRATION_ID = new ParseUUIDPipe({ exceptionFactory: () => memberRegistrationNotFound() });

const REGISTRATION_NOT_FOUND_RESPONSE = {
  type: ApiErrorDto,
  description: "MEMBER_REGISTRATION_NOT_FOUND",
};

const REGISTRATION_ID_PARAM = { name: "id", format: "uuid", description: "Person id." };

/**
 * MemberRegistrationsController — validation of member registrations by coordination
 * (GUS-91, RN-08).
 *
 *  GET   /member-registrations              — listMemberRegistrations   (default status: pending)
 *  GET   /member-registrations/:id          — getMemberRegistration     (full data, cpf included: RNF-14)
 *  PATCH /member-registrations/:id/approve  — approveMemberRegistration
 *  PATCH /member-registrations/:id/reject   — rejectMemberRegistration
 *
 * :id is the Person id. Every route requires Permission.INVITES_MANAGE ("validar cadastro":
 * coordinator). The AuthGuard runs before the ValidationPipe, so a director or a member gets
 * 403 even with an invalid body.
 */
@ApiTags("people")
@Controller("member-registrations")
@ApiStandardErrors()
@RequirePermission(Permission.INVITES_MANAGE)
export class MemberRegistrationsController {
  constructor(private readonly membersService: MembersService) {}

  /**
   * The validation queue: registrations of one status (pending by default), the oldest
   * submission first. Searches by name or RA. Never carries CPF, address, phone nor e-mails.
   */
  @Get()
  @ApiOkResponsePaginated(MemberRegistrationListItemDto)
  listMemberRegistrations(
    @Query() query: ListMemberRegistrationsQueryDto,
  ): Promise<PaginatedResult<MemberRegistrationListItemDto>> {
    return this.membersService.listRegistrations(query);
  }

  /** The registration in full, with the full CPF: this route is for coordination only. */
  @Get(":id")
  @ApiParam(REGISTRATION_ID_PARAM)
  @ApiOkResponse({ type: MemberRegistrationResponseDto })
  @ApiNotFoundResponse(REGISTRATION_NOT_FOUND_RESPONSE)
  getMemberRegistration(
    @Param("id", REGISTRATION_ID) id: string,
  ): Promise<MemberRegistrationResponseDto> {
    return this.membersService.getRegistration(id);
  }

  /**
   * Approves a pending registration: sets role, department, main function and join date and
   * grants the access. Approving twice answers 409 REGISTRATION_NOT_PENDING.
   * `superadmin` answers 400 INVALID_ROLE; an unknown department, 400 DEPARTMENT_NOT_FOUND.
   */
  @Patch(":id/approve")
  @ApiParam(REGISTRATION_ID_PARAM)
  @ApiOkResponse({ type: MemberRegistrationResponseDto })
  @ApiNotFoundResponse(REGISTRATION_NOT_FOUND_RESPONSE)
  @ApiConflictResponse({ type: ApiErrorDto, description: "REGISTRATION_NOT_PENDING" })
  approveMemberRegistration(
    @Param("id", REGISTRATION_ID) id: string,
    @Body() dto: ApproveMemberRegistrationDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<MemberRegistrationResponseDto> {
    return this.membersService.approve(id, dto, actor.id);
  }

  /**
   * Rejects a pending registration. The note is mandatory. The person keeps no access and
   * may submit again with a new invite.
   */
  @Patch(":id/reject")
  @ApiParam(REGISTRATION_ID_PARAM)
  @ApiOkResponse({ type: MemberRegistrationResponseDto })
  @ApiNotFoundResponse(REGISTRATION_NOT_FOUND_RESPONSE)
  @ApiConflictResponse({ type: ApiErrorDto, description: "REGISTRATION_NOT_PENDING" })
  rejectMemberRegistration(
    @Param("id", REGISTRATION_ID) id: string,
    @Body() dto: RejectMemberRegistrationDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<MemberRegistrationResponseDto> {
    return this.membersService.reject(id, dto, actor.id);
  }
}
