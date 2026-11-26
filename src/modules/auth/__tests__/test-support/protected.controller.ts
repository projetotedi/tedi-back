import { Controller, Get } from "@nestjs/common";
import { Roles } from "@shared/decorators/roles.decorator";
import { Public } from "@shared/decorators/public.decorator";
import { CurrentUser } from "@shared/decorators/current-user.decorator";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { Role } from "@shared/enums/role.enum";

/**
 * Controller used exclusively by the AuthGuard e2e tests.
 * Not registered in any production module.
 */
@Controller("test")
export class ProtectedController {
  /** No decorator — requires a valid session (any role). */
  @Get("open")
  open(@CurrentUser() user: AuthUser): { userId: string; role: Role } {
    return { userId: user?.id, role: user?.role };
  }

  /**
   * GUS-91: echoes the departments the AuthGuard attached to the user. A separate route, so the
   * exact body of GET /test/open does not change.
   */
  @Get("departments")
  departments(@CurrentUser() user: AuthUser): { departmentIds: readonly string[] | null } {
    return { departmentIds: user?.departmentIds ?? null };
  }

  /** @Public() — no session required. */
  @Get("public")
  @Public()
  publicRoute(): { ok: boolean } {
    return { ok: true };
  }

  /** @Roles(Role.DIRECTOR) — requires at least DIRECTOR. */
  @Get("director")
  @Roles(Role.DIRECTOR)
  directorRoute(@CurrentUser() user: AuthUser): { userId: string; role: Role } {
    return { userId: user?.id, role: user?.role };
  }
}
