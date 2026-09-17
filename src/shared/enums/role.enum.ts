// Hierarchy order: member < director < coordinator < superadmin.
// SUPERADMIN is a technical role: never granted through the API, only via direct
// SQL. It automatically satisfies any @Roles() check (see roleSatisfies() below).
export enum Role {
  MEMBER = "member",
  DIRECTOR = "director",
  COORDINATOR = "coordinator",
  SUPERADMIN = "superadmin",
}

const RANK: Record<Role, number> = {
  [Role.MEMBER]: 0,
  [Role.DIRECTOR]: 1,
  [Role.COORDINATOR]: 2,
  [Role.SUPERADMIN]: 3,
};

/**
 * Returns true when userRole satisfies the minRole requirement.
 * SUPERADMIN always satisfies any minRole.
 * Returns false for null/undefined userRole.
 */
export function roleSatisfies(userRole: Role | null | undefined, minRole: Role): boolean {
  if (userRole == null) return false;
  return RANK[userRole] >= RANK[minRole];
}
