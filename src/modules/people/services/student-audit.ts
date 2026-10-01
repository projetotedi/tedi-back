/**
 * Allow-list: the only student values that may appear in AuditableActionEvent
 * before/after (RNF-13, LGPD data minimization).
 *
 * email, phone, emergencyContact*, accessibilityNeed, supportResource and classNeeds are
 * never copied as values: an update lists them by name in `changedFields` only. The
 * persistence listener (E9.b) turns the event into a permanent audit log, so what enters
 * here must be safe to keep. An allow-list (not a deny-list) makes any new field start out
 * of the event.
 */
export const STUDENT_AUDIT_FIELDS = [
  "name",
  "birthDate",
  "education",
  "hasSmartphone",
  "hasComputer",
  "howFoundUs",
] as const;

/** Picks only the allow-listed fields from the given values. */
export function auditSnapshot(values: Partial<Record<string, unknown>>): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const field of STUDENT_AUDIT_FIELDS) {
    if (values[field] !== undefined) {
      snapshot[field] = values[field];
    }
  }
  return snapshot;
}
