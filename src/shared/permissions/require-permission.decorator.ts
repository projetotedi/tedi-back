import { SetMetadata } from "@nestjs/common";
import { Permission } from "./permission.enum";

export const PERMISSION_KEY = "auth:permission";

/**
 * Marks a route with the Permission it requires.
 * The AuthGuard denies (403 FORBIDDEN) when the scope of the user's role is "none".
 * Fine-grained scope (own, department, allocated) is checked by PermissionPolicy in the service.
 *
 * Usage:
 *   @RequirePermission(Permission.ACCESS_MANAGE)
 */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);
