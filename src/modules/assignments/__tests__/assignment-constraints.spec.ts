import { QueryFailedError } from "typeorm";
import { violatedConstraint } from "../services/assignment-constraints";

function queryFailure(driverError: unknown): QueryFailedError {
  // The constructor takes an Error; the driver hands over whatever it has, so the test does too.
  return new QueryFailedError("INSERT INTO lesson_assignments", [], driverError as Error);
}

describe("violatedConstraint", () => {
  it("answers the code and the constraint of a QueryFailedError of the driver", () => {
    const driverError = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint: "uq_lesson_assignments_lesson_id_person_id_active",
    });

    expect(violatedConstraint(queryFailure(driverError))).toEqual({
      code: "23505",
      constraint: "uq_lesson_assignments_lesson_id_person_id_active",
    });
  });

  it("answers null for an error that is not a QueryFailedError, and for a driverError without code or constraint", () => {
    const plain = Object.assign(new Error("boom"), {
      code: "23505",
      constraint: "uq_lesson_assignments_lesson_id_person_id_active",
    });

    expect(violatedConstraint(plain)).toBeNull();
    expect(violatedConstraint("23505")).toBeNull();
    expect(violatedConstraint(undefined)).toBeNull();
    expect(violatedConstraint(queryFailure(new Error("connection lost")))).toBeNull();
    expect(
      violatedConstraint(queryFailure(Object.assign(new Error(), { code: "23505" }))),
    ).toBeNull();
    expect(
      violatedConstraint(
        queryFailure(Object.assign(new Error(), { constraint: "fk_lesson_assignments_lesson_id" })),
      ),
    ).toBeNull();
    expect(
      violatedConstraint(
        queryFailure(Object.assign(new Error(), { code: 23505, constraint: "uq_x" })),
      ),
    ).toBeNull();
    expect(
      violatedConstraint(
        queryFailure(Object.assign(new Error(), { code: "23505", constraint: null })),
      ),
    ).toBeNull();
    expect(violatedConstraint(queryFailure("23505"))).toBeNull();
    expect(
      violatedConstraint(Object.assign(queryFailure(new Error("boom")), { driverError: null })),
    ).toBeNull();
  });
});
