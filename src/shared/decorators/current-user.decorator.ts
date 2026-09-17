import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { REQUEST_USER_KEY } from "@modules/auth/auth.constants";
import { AuthUser } from "./auth-user.type";

/**
 * Route handler parameter decorator that extracts the authenticated user
 * from the request object after the AuthGuard has resolved it.
 *
 * Usage:
 *   async myRoute(@CurrentUser() user: AuthUser) { ... }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<Record<string, AuthUser>>();
    return request[REQUEST_USER_KEY];
  },
);
