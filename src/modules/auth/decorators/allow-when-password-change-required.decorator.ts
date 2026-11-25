import { SetMetadata } from "@nestjs/common";

export const ALLOW_WHEN_PASSWORD_CHANGE_REQUIRED_KEY = "auth:allowWhenPasswordChangeRequired";

/**
 * Lets an authenticated route answer while the account still has to change its password
 * (GUS-93). Without it the AuthGuard answers 403 PASSWORD_CHANGE_REQUIRED, so the account can
 * reach nothing but the routes that let it see who it is and replace the password.
 *
 * Lives in `auth`, not in `shared`: only the auth routes use it. `@Public()` routes never reach
 * this check, and `@Roles`/`@RequirePermission` still apply to a route marked with it.
 *
 * Usage:
 *   @AllowWhenPasswordChangeRequired()
 */
export const AllowWhenPasswordChangeRequired = () =>
  SetMetadata(ALLOW_WHEN_PASSWORD_CHANGE_REQUIRED_KEY, true);
