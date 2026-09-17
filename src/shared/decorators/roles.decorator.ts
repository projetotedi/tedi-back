import { SetMetadata } from "@nestjs/common";
import { Role } from "@shared/enums/role.enum";

export const ROLES_KEY = "auth:roles";

/**
 * Marks a route with the minimum Role required to access it.
 * The AuthGuard reads this metadata and applies roleSatisfies() to enforce it.
 *
 * Usage:
 *   @Roles(Role.DIRECTOR)  — accepts DIRECTOR and COORDINATOR (and SUPERADMIN).
 */
export const Roles = (minRole: Role) => SetMetadata(ROLES_KEY, minRole);
