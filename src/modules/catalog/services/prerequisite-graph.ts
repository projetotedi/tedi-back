/** One prerequisite link (RF-021): `courseId` requires `prerequisiteId`. */
export interface PrerequisiteEdge {
  courseId: string;
  prerequisiteId: string;
}

/**
 * True when making `courseId` require exactly `prerequisiteIds` would close a cycle in the graph
 * of prerequisites: one of them is `courseId` itself, or reaches it through the prerequisites of
 * the prerequisites (A requires B, B requires C, so C cannot require A).
 *
 * `edges` is the graph as it is now. The edges that leave `courseId` are dropped first, because
 * the new list replaces them. Pure function: an iterative depth-first search with a visited set,
 * so it ends even when the graph already has a cycle somewhere else.
 */
export function createsPrerequisiteCycle(
  courseId: string,
  prerequisiteIds: readonly string[],
  edges: readonly PrerequisiteEdge[],
): boolean {
  if (prerequisiteIds.includes(courseId)) return true;

  const prerequisitesOf = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.courseId === courseId) continue;

    const known = prerequisitesOf.get(edge.courseId);
    if (known === undefined) {
      prerequisitesOf.set(edge.courseId, [edge.prerequisiteId]);
    } else {
      known.push(edge.prerequisiteId);
    }
  }

  const visited = new Set<string>();
  const pending = [...prerequisiteIds];
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    if (current === courseId) return true;
    if (visited.has(current)) continue;

    visited.add(current);
    pending.push(...(prerequisitesOf.get(current) ?? []));
  }

  return false;
}
