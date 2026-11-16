import "reflect-metadata";
import { LessonStatus, LessonSummary } from "@modules/lessons/services/lessons.service";
import { LessonAssignment } from "../entities/lesson-assignment.entity";
import { AssignmentRole } from "../enums/assignment-role.enum";
import { AssignmentSource } from "../enums/assignment-source.enum";
import { AssignmentStatus } from "../enums/assignment-status.enum";
import {
  toLessonAssignmentResponse,
  toMemberAssignmentResponse,
} from "../services/assignment-response.mapper";

const ACTOR_ID = "01999a3e-0000-7000-8000-0000000000aa";
const PERSON_ID = "01999a3e-0000-7000-8000-0000000000b1";
const LESSON_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
const ASSIGNMENT_ID = "01999a3e-7c1b-7000-8000-0000000000a1";
const CREATED_AT = new Date("2026-03-01T12:00:00.000Z");
const REVIEWED_AT = new Date("2026-03-02T12:00:00.000Z");

const NOTE = "Cobre a segunda hora da aula.";

const CAN_SEE_NOTE = { canSeeNote: true };
const CANNOT_SEE_NOTE = { canSeeNote: false };

function buildAssignment(overrides: Partial<LessonAssignment> = {}): LessonAssignment {
  return Object.assign(new LessonAssignment(), {
    id: ASSIGNMENT_ID,
    lessonId: LESSON_ID,
    personId: PERSON_ID,
    role: AssignmentRole.MONITOR,
    status: AssignmentStatus.CONFIRMED,
    source: AssignmentSource.DIRECT,
    note: NOTE,
    createdById: ACTOR_ID,
    reviewedById: ACTOR_ID,
    reviewedAt: REVIEWED_AT,
    cancelledById: null,
    cancelledAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    ...overrides,
  });
}

function buildLesson(): LessonSummary {
  return {
    id: LESSON_ID,
    classId: "01999a3e-7c1b-7000-8000-0000000000c1",
    title: "Teclado, mouse e janelas",
    date: "2026-03-10",
    startTime: "14:00",
    endTime: "15:30",
    status: LessonStatus.PLANNED,
    expectedMonitors: 2,
  };
}

const PERSON = { id: PERSON_ID, name: "Monitor Um" };

describe("toLessonAssignmentResponse", () => {
  describe("the note (RNF-13)", () => {
    it("shows the note to who can see it", () => {
      const response = toLessonAssignmentResponse(buildAssignment(), PERSON, CAN_SEE_NOTE);

      expect(response.note).toBe(NOTE);
    });

    it("answers note null to who cannot, though the assignment has one", () => {
      const response = toLessonAssignmentResponse(buildAssignment(), PERSON, CANNOT_SEE_NOTE);

      expect(response.note).toBeNull();
      expect(JSON.stringify(response)).not.toContain(NOTE);
    });

    it("answers null for an assignment without a note, to everybody", () => {
      for (const note of [null, undefined]) {
        const assignment = buildAssignment({ note: note as null });

        expect(toLessonAssignmentResponse(assignment, PERSON, CAN_SEE_NOTE).note).toBeNull();
        expect(toLessonAssignmentResponse(assignment, PERSON, CANNOT_SEE_NOTE).note).toBeNull();
      }
    });

    it("treats an empty note as any other text: shown to who can see it, hidden from who cannot", () => {
      // The DTO turns a blank note into null, so a blank one in the entity is not a case of the
      // service; the mapper does not invent a rule for it.
      const assignment = buildAssignment({ note: "" });

      expect(toLessonAssignmentResponse(assignment, PERSON, CAN_SEE_NOTE).note).toBe("");
      expect(toLessonAssignmentResponse(assignment, PERSON, CANNOT_SEE_NOTE).note).toBeNull();
    });

    it("changes nothing but the note between who can see it and who cannot", () => {
      const assignment = buildAssignment({
        role: AssignmentRole.TEACHER,
        source: AssignmentSource.APPLICATION,
        status: AssignmentStatus.CANCELLED,
        cancelledById: ACTOR_ID,
        cancelledAt: REVIEWED_AT,
      });

      const shown = toLessonAssignmentResponse(assignment, PERSON, CAN_SEE_NOTE);
      const hidden = toLessonAssignmentResponse(assignment, PERSON, CANNOT_SEE_NOTE);

      expect(hidden).toEqual({ ...shown, note: null });
      expect(Object.keys(hidden)).toEqual(Object.keys(shown));
    });

    it("does not change the entity it reads: the note stays in the row", () => {
      const assignment = buildAssignment();

      toLessonAssignmentResponse(assignment, PERSON, CANNOT_SEE_NOTE);

      expect(assignment.note).toBe(NOTE);
    });

    it("makes the decision a required argument: a caller that forgets it does not compile", () => {
      // The check is the compiler's, and it runs with the suite (ts-jest reports a type error as a
      // failure): without the directive below the call would be an error, and with it, a call that
      // compiles would be one. The function is never called.
      const forgetful = () =>
        // @ts-expect-error the third argument has no default, so no answer is built by accident
        toLessonAssignmentResponse(buildAssignment(), PERSON);

      expect(typeof forgetful).toBe("function");
    });
  });

  it("maps every field of the assignment and the member, and nothing else", () => {
    const response = toLessonAssignmentResponse(buildAssignment(), PERSON, CAN_SEE_NOTE);

    expect(response).toEqual({
      id: ASSIGNMENT_ID,
      lessonId: LESSON_ID,
      person: { id: PERSON_ID, name: "Monitor Um" },
      role: AssignmentRole.MONITOR,
      status: AssignmentStatus.CONFIRMED,
      source: AssignmentSource.DIRECT,
      note: NOTE,
      createdById: ACTOR_ID,
      reviewedById: ACTOR_ID,
      reviewedAt: REVIEWED_AT,
      cancelledById: null,
      cancelledAt: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
    expect(response).not.toHaveProperty("deletedAt");
    expect(response).not.toHaveProperty("personId");
  });

  it("shows only the id and the name of the person, and person null when she is gone", () => {
    const withExtras = { ...PERSON, email: "monitor@example.com", ra: "a2210001" };

    expect(
      Object.keys(
        toLessonAssignmentResponse(buildAssignment(), withExtras, CAN_SEE_NOTE).person ?? {},
      ),
    ).toEqual(["id", "name"]);
    expect(toLessonAssignmentResponse(buildAssignment(), null, CAN_SEE_NOTE).person).toBeNull();
  });

  it("answers null for the optional columns that an inserted entity does not carry", () => {
    const bare = Object.assign(buildAssignment(), {
      note: undefined,
      reviewedById: undefined,
      reviewedAt: undefined,
      cancelledById: undefined,
      cancelledAt: undefined,
    });

    const response = toLessonAssignmentResponse(bare, PERSON, CAN_SEE_NOTE);

    for (const field of [
      "note",
      "reviewedById",
      "reviewedAt",
      "cancelledById",
      "cancelledAt",
    ] as const) {
      expect(response[field]).toBeNull();
    }
  });
});

describe("toMemberAssignmentResponse", () => {
  it("has the lesson, the role, the status and the source, and no note, whatever the assignment has", () => {
    const response = toMemberAssignmentResponse(buildAssignment({ note: NOTE }), buildLesson());

    expect(Object.keys(response).sort()).toEqual([
      "createdAt",
      "id",
      "lesson",
      "role",
      "source",
      "status",
    ]);
    expect(JSON.stringify(response)).not.toContain(NOTE);
    expect(response.lesson).toEqual({
      id: LESSON_ID,
      title: "Teclado, mouse e janelas",
      date: "2026-03-10",
      startTime: "14:00",
      endTime: "15:30",
      status: LessonStatus.PLANNED,
    });
  });
});
