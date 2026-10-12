import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ApiOkResponsePaginated } from "@shared/pagination/api-paginated-response.decorator";
import { PaginatedResult } from "@shared/pagination/pagination.util";
import { Permission } from "@shared/permissions/permission.enum";
import { RequirePermission } from "@shared/permissions/require-permission.decorator";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { ListMembersQueryDto } from "../dto/list-members-query.dto";
import { MemberListItemResponseDto } from "../dto/member-list-item.response.dto";
import { MembersService } from "../services/members.service";

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
}
