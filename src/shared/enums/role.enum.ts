// Hierarchy order: member < director < coordinator < superadmin.
// SUPERADMIN is a technical role: never granted through the API, only via direct
// SQL. It automatically satisfies any @Roles() check (see roleSatisfies() in
// GUS-75).
export enum Role {
  MEMBER = "member",
  DIRECTOR = "director",
  COORDINATOR = "coordinator",
  SUPERADMIN = "superadmin",
}
