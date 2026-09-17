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
