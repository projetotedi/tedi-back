import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { CurrentUser } from "@shared/decorators/current-user.decorator";
import { Permission } from "@shared/permissions/permission.enum";
import { RequirePermission } from "@shared/permissions/require-permission.decorator";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { MyProfileResponseDto } from "../dto/my-profile.response.dto";
import { MyProfileService } from "../services/my-profile.service";

/**
 * MyProfileController — "Meu perfil" (GUS-122): the registration of the logged-in person.
 *
 *  GET /members/me — getMyProfile (account.manageOwn: member, director, coordinator, superadmin)
 *
 * There is no path param, query or body: the person is always the one of the session
 * (`@CurrentUser()`), so no route here returns somebody else's profile. The profile of another
 * member is a different route with its own scope check (GUS-144).
 *
 * Route order matters: `me` must be registered before any `members/:id` route, or the id pipe of
 * that route would take "me" for an id. PeopleModule lists this controller first for that.
 */
@ApiTags("people")
@Controller("members")
@ApiStandardErrors()
export class MyProfileController {
  constructor(private readonly myProfileService: MyProfileService) {}

  /**
   * The logged-in person's own registration: person data, member profile (null fields without
   * one, e.g. the seeded admin), department, masked CPF and last access.
   * `lastLoginAt` is the login BEFORE the current one; null until the second login.
   * Personal data (RNF-13/14): never logged. The CPF only comes masked.
   */
  @Get("me")
  @RequirePermission(Permission.ACCOUNT_MANAGE_OWN)
  @ApiOkResponse({ type: MyProfileResponseDto })
  getMyProfile(@CurrentUser() user: AuthUser): Promise<MyProfileResponseDto> {
    return this.myProfileService.getMyProfile(user.id);
  }
}
