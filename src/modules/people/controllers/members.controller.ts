import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from "@nestjs/common";
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
import { ApiOkResponsePaginated } from "@shared/pagination/api-paginated-response.decorator";
import { PaginatedResult } from "@shared/pagination/pagination.util";
import { Permission } from "@shared/permissions/permission.enum";
import { RequirePermission } from "@shared/permissions/require-permission.decorator";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { DeactivateMemberDto } from "../dto/deactivate-member.dto";
import { ListMembersQueryDto } from "../dto/list-members-query.dto";
import { MemberDetailResponseDto } from "../dto/member-detail.response.dto";
import { MemberListItemResponseDto } from "../dto/member-list-item.response.dto";
import { MembersService, memberNotFound } from "../services/members.service";

/**
 * A malformed id is a member that does not exist: same 404 as an unknown id.
 * Without the pipe, Postgres would reject the value and the answer would be a 500.
 */
const MEMBER_ID = new ParseUUIDPipe({ exceptionFactory: () => memberNotFound() });

const MEMBER_ID_PARAM = { name: "id", format: "uuid", description: "Person id." };

/**
 * MembersController — the members list (GUS-121), the member record (GUS-144) and the
 * deactivation of a member (GUS-147).
 *
 *  GET /members                  — listMembers      (members.list: director and coordinator, every
 *                                                    member)
 *  GET /members/:id              — getMember        (members.view: coordinator every member,
 *                                                    director only a member of the own department,
 *                                                    a member has no access)
 *  PATCH /members/:id/deactivate — deactivateMember (members.deactivate: coordination and
 *                                                    superadmin only)
 *  PATCH /members/:id/reactivate — reactivateMember (members.deactivate, the same permission)
 *
 * :id is the Person id. `GET /members/me` ("Meu perfil", GUS-122) belongs to MyProfileController,
 * which PeopleModule registers BEFORE this controller: registered after it, `:id` would take "me"
 * for an id. The AuthGuard runs before the id pipe, so a member gets 403 even with a malformed id.
 */
@ApiTags("people")
@Controller("members")
@ApiStandardErrors()
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Get()
  @RequirePermission(Permission.MEMBERS_LIST)
  @ApiOkResponsePaginated(MemberListItemResponseDto)
  listMembers(
    @Query() query: ListMembersQueryDto,
  ): Promise<PaginatedResult<MemberListItemResponseDto>> {
    return this.membersService.listMembers(query);
  }

  /**
   * The member record: person data, member profile, department and who approved the registration
   * (allocations, attendance and the hours bank are other routes). Answers for every row of
   * `GET /members`, including pending and rejected registrations and the people without a member
   * profile (the seeded admin: member fields null). A director gets 403 FORBIDDEN_SCOPE outside
   * the own department. The CPF only comes masked (`cpfMasked`); the full CPF is on
   * `GET /member-registrations/:id`. Personal data (RNF-13/14): never logged.
   */
  @Get(":id")
  @RequirePermission(Permission.MEMBERS_VIEW)
  @ApiParam(MEMBER_ID_PARAM)
  @ApiOkResponse({ type: MemberDetailResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: "FORBIDDEN | FORBIDDEN_SCOPE" })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: "MEMBER_NOT_FOUND" })
  getMember(
    @Param("id", MEMBER_ID) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<MemberDetailResponseDto> {
    return this.membersService.getMember(id, user);
  }

  /**
   * Ends the participation of a member (RF-011): exit date, reason and an optional note, and the
   * access is disabled in the same transaction. Only approved members. Deactivating again answers
   * 409 MEMBER_INACTIVE. The note is stored but never returned.
   */
  @Patch(":id/deactivate")
  @RequirePermission(Permission.MEMBERS_DEACTIVATE)
  @ApiParam(MEMBER_ID_PARAM)
  @ApiOkResponse({ type: MemberDetailResponseDto })
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description: "VALIDATION_FAILED | EXIT_DATE_BEFORE_JOINED_AT",
  })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: "FORBIDDEN | OWN_ACCOUNT" })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: "MEMBER_NOT_FOUND" })
  @ApiConflictResponse({
    type: ApiErrorDto,
    description:
      "NO_MEMBER_PROFILE | REGISTRATION_NOT_APPROVED | MEMBER_INACTIVE | LAST_COORDINATOR",
  })
  deactivateMember(
    @Param("id", MEMBER_ID) id: string,
    @Body() dto: DeactivateMemberDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<MemberDetailResponseDto> {
    return this.membersService.deactivateMember(id, dto, actor);
  }

  /**
   * The member is active again and the exit is cleared. The access is NOT enabled: use
   * PATCH /access/:id/enabled. Reactivating an active member answers 200 unchanged.
   */
  @Patch(":id/reactivate")
  @RequirePermission(Permission.MEMBERS_DEACTIVATE)
  @ApiParam(MEMBER_ID_PARAM)
  @ApiOkResponse({ type: MemberDetailResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: "FORBIDDEN | OWN_ACCOUNT" })
  @ApiNotFoundResponse({ type: ApiErrorDto, description: "MEMBER_NOT_FOUND" })
  reactivateMember(
    @Param("id", MEMBER_ID) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<MemberDetailResponseDto> {
    return this.membersService.reactivateMember(id, actor);
  }
}
