import { Role } from "@shared/enums/role.enum";

/**
 * Compact user representation attached to the request after successful auth.
 * Does NOT expose the full Person entity — only what guards and handlers need.
 */
export interface AuthUser {
  id: string;
  role: Role;
  accessEnabled: boolean;
  /**
   * Filled by the AuthGuard with the department of the person's approved member profile
   * (0 or 1 id). Empty = no department (the department scope denies third parties).
   * Optional so AuthUser literals in tests and the DEV_FAKE_ROLE user keep compiling.
   */
  departmentIds?: readonly string[];
}
