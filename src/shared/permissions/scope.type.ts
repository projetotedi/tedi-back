/**
 * Scope of a permission for a role.
 *
 *  - all           — any target
 *  - own           — only the person's own data
 *  - department    — only members of the person's own department
 *  - allocated     — only lessons where the person is allocated as teacher or monitor
 *  - lessonTeacher — only lessons where the person is allocated as teacher
 *  - none          — not allowed
 */
export const SCOPES = ["all", "own", "department", "allocated", "lessonTeacher", "none"] as const;

export type Scope = (typeof SCOPES)[number];
