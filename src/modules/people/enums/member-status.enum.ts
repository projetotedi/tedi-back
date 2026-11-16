/**
 * Participation of a member in the project (RF-011, F1.6): inactive only after a deactivation
 * (PATCH /members/:id/deactivate). Independent from the validation of the registration
 * (MemberRegistrationStatus): a pending or rejected registration is still active.
 */
export enum MemberStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
}
