/**
 * Facts about the resource being accessed, already resolved by the calling service.
 * `shared/` never queries the domain: the service loads these and hands them to the policy.
 * A missing fact makes the scope rule deny (fail closed).
 */
export interface PermissionTarget {
  /** Target person: resolves "own" and the self-attendance rule. */
  personId?: string;
  /** Departments of the target person: resolves "department". */
  departmentIds?: readonly string[];
  /** Teachers allocated to the lesson: resolves "allocated" and "lessonTeacher". */
  lessonTeacherIds?: readonly string[];
  /** Monitors allocated to the lesson: resolves "allocated". */
  lessonMonitorIds?: readonly string[];
}

/**
 * Filter that a service must translate into the WHERE clause of a listing query.
 * Listings are filtered in the query, never after loading.
 */
export type ListScopeFilter =
  | { kind: "all" }
  | { kind: "none" }
  | { kind: "own"; personId: string }
  | { kind: "departments"; departmentIds: readonly string[] }
  | { kind: "allocated"; personId: string }
  | { kind: "lessonTeacher"; personId: string };
