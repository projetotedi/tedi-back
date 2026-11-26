import { createsPrerequisiteCycle, PrerequisiteEdge } from "../services/prerequisite-graph";

/** "from requires to": the edge list reads like the sentences of the tests. */
function requires(from: string, to: string): PrerequisiteEdge {
  return { courseId: from, prerequisiteId: to };
}

describe("createsPrerequisiteCycle", () => {
  it("detects a course that requires itself", () => {
    expect(createsPrerequisiteCycle("A", ["A"], [])).toBe(true);
    expect(createsPrerequisiteCycle("A", ["B", "A"], [requires("B", "C")])).toBe(true);
  });

  it("detects a direct cycle (Básica requires Intermediária, which requires Básica)", () => {
    const edges = [requires("Intermediária", "Básica")];

    expect(createsPrerequisiteCycle("Básica", ["Intermediária"], edges)).toBe(true);
  });

  it("detects a transitive cycle (A→B→C, C requires A)", () => {
    const edges = [requires("A", "B"), requires("B", "C")];

    expect(createsPrerequisiteCycle("C", ["A"], edges)).toBe(true);
  });

  it("detects a cycle that goes through a prerequisite that is not the first of the list", () => {
    const edges = [requires("B", "C"), requires("C", "D"), requires("D", "A")];

    expect(createsPrerequisiteCycle("A", ["E", "F", "B"], edges)).toBe(true);
  });

  it("accepts a chain that only gets longer", () => {
    const edges = [requires("A", "B"), requires("B", "C")];

    expect(createsPrerequisiteCycle("D", ["A"], edges)).toBe(false);
    expect(createsPrerequisiteCycle("A", ["B"], edges)).toBe(false);
  });

  it("accepts a diamond without a cycle", () => {
    // D requires B and C, and both require A.
    const edges = [requires("D", "B"), requires("D", "C"), requires("B", "A"), requires("C", "A")];

    expect(createsPrerequisiteCycle("E", ["D", "A"], edges)).toBe(false);
    expect(createsPrerequisiteCycle("D", ["B", "C"], edges)).toBe(false);
    expect(createsPrerequisiteCycle("F", ["B", "C", "A"], edges)).toBe(false);
  });

  it("ignores the current edges of the edited course", () => {
    // C requires A today. Edited to require B instead, the old link to A is gone.
    const edges = [requires("C", "A"), requires("A", "B")];

    expect(createsPrerequisiteCycle("C", ["B"], edges)).toBe(false);
    expect(createsPrerequisiteCycle("C", [], edges)).toBe(false);
    // Keeping the same prerequisite is not a cycle either.
    expect(createsPrerequisiteCycle("C", ["A"], edges)).toBe(false);
  });

  it("still sees the cycle through the other courses when the edited one keeps old edges", () => {
    // C requires A today and B requires C. Making C require B closes C→B→C.
    const edges = [requires("C", "A"), requires("B", "C")];

    expect(createsPrerequisiteCycle("C", ["B"], edges)).toBe(true);
    expect(createsPrerequisiteCycle("C", ["A", "B"], edges)).toBe(true);
  });

  it("terminates on a graph that already has a cycle elsewhere", () => {
    // X and Y require each other (a graph the service would never build, but the search must end).
    const edges = [requires("X", "Y"), requires("Y", "X"), requires("Y", "Z")];

    // The search walks the whole X↔Y loop and Z, never meets C, and stops.
    expect(createsPrerequisiteCycle("C", ["X"], edges)).toBe(false);
    // Z is reachable from X (X→Y→Z), so Z requiring X closes a cycle through the old loop.
    expect(createsPrerequisiteCycle("Z", ["X"], edges)).toBe(true);
  });

  it("accepts an empty list of prerequisites and an empty graph", () => {
    expect(createsPrerequisiteCycle("A", [], [requires("B", "A")])).toBe(false);
    expect(createsPrerequisiteCycle("A", ["B"], [])).toBe(false);
    expect(createsPrerequisiteCycle("A", [], [])).toBe(false);
  });

  it("handles a long chain without recursion", () => {
    const edges = Array.from({ length: 5000 }, (_, index) =>
      requires(`course-${index}`, `course-${index + 1}`),
    );

    expect(createsPrerequisiteCycle("course-5000", ["course-0"], edges)).toBe(true);
    expect(createsPrerequisiteCycle("course-9999", ["course-0"], edges)).toBe(false);
  });

  it("does not change what it receives", () => {
    const edges = [requires("A", "B"), requires("B", "C")];
    const prerequisiteIds = ["A", "D"];

    createsPrerequisiteCycle("C", prerequisiteIds, edges);

    expect(edges).toEqual([requires("A", "B"), requires("B", "C")]);
    expect(prerequisiteIds).toEqual(["A", "D"]);
  });
});
