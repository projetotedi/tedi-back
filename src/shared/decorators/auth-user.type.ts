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
   * Filled by the AuthGuard from GUS-91 on. Absent = no department
   * (the "department" scope denies third parties).
   */
  departmentIds?: readonly string[];
}
