import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate, ValidationError } from "class-validator";
import { flattenValidationErrors } from "@shared/filters/http-exception.filter";
import { CancelLessonDto } from "../dto/cancel-lesson.dto";
import { CreateLessonDto } from "../dto/create-lesson.dto";
import { RescheduleLessonDto } from "../dto/reschedule-lesson.dto";
import { UpdateLessonDto } from "../dto/update-lesson.dto";
import { LessonStatus } from "../enums/lesson-status.enum";

const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const PLAN_ID = "01999a3e-7c1b-7000-8000-000000000011";

const VALID_BODY = {
  classId: CLASS_ID,
  title: "Teclado, mouse e janelas",
  date: "2026-03-10",
  startTime: "14:00",
  endTime: "15:30",
};

function fieldsOf(errors: ValidationError[]): string[] {
  return errors.map((error) => error.property).sort();
}

function messagesOf(errors: ValidationError[]): string[] {
  return flattenValidationErrors(errors)
    .map((error) => error.message)
    .sort();
}

async function checkCreate(body: Record<string, unknown>) {
  const dto = plainToInstance(CreateLessonDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: fieldsOf(errors) };
}

async function checkUpdate(body: Record<string, unknown>) {
  const dto = plainToInstance(UpdateLessonDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: fieldsOf(errors) };
}

async function checkCancel(body: Record<string, unknown>) {
  const dto = plainToInstance(CancelLessonDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: fieldsOf(errors) };
}

async function checkReschedule(body: Record<string, unknown>) {
  const dto = plainToInstance(RescheduleLessonDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: fieldsOf(errors) };
}

describe("CreateLessonDto", () => {
  it("accepts a lesson on its own: a class, a title, a day and the two times, and nothing else", async () => {
    const { dto, errors } = await checkCreate(VALID_BODY);

    expect(errors).toHaveLength(0);
    expect(dto.classId).toBe(CLASS_ID);
    expect(dto.title).toBe("Teclado, mouse e janelas");
    expect(dto.date).toBe("2026-03-10");
    expect(dto.startTime).toBe("14:00");
    expect(dto.endTime).toBe("15:30");
    expect(dto.lessonPlanId).toBeUndefined();
    expect(dto.sequenceOrder).toBeUndefined();
    expect(dto.objective).toBeUndefined();
    expect(dto.location).toBeUndefined();
    expect(dto.expectedStudents).toBeUndefined();
    expect(dto.expectedMonitors).toBeUndefined();
    expect(dto.subject).toBeUndefined();
  });

  it("accepts every optional field", async () => {
    const { dto, errors } = await checkCreate({
      ...VALID_BODY,
      lessonPlanId: PLAN_ID,
      sequenceOrder: 3,
      objective: "Familiarizar o aluno com o teclado.",
      location: "Laboratório 3, bloco B",
      expectedStudents: 15,
      expectedMonitors: 2,
      subject: "Primeiro contato com o computador",
    });

    expect(errors).toHaveLength(0);
    expect(dto.lessonPlanId).toBe(PLAN_ID);
    expect(dto.sequenceOrder).toBe(3);
    expect(dto.objective).toBe("Familiarizar o aluno com o teclado.");
    expect(dto.location).toBe("Laboratório 3, bloco B");
    expect(dto.expectedStudents).toBe(15);
    expect(dto.expectedMonitors).toBe(2);
    expect(dto.subject).toBe("Primeiro contato com o computador");
  });

  describe("title", () => {
    it("is required without a lessonPlanId", async () => {
      const { title: _title, ...withoutTitle } = VALID_BODY;

      expect((await checkCreate(withoutTitle)).fields).toEqual(["title"]);
      expect((await checkCreate({ ...withoutTitle, lessonPlanId: null })).fields).toEqual([
        "title",
      ]);
    });

    it("is optional with a lessonPlanId: the service copies the one of the plan", async () => {
      const { title: _title, ...withoutTitle } = VALID_BODY;

      const { dto, errors } = await checkCreate({ ...withoutTitle, lessonPlanId: PLAN_ID });

      expect(errors).toHaveLength(0);
      expect(dto.title).toBeUndefined();
    });

    it("accepts a body with a lessonPlanId and a title, which wins over the copy", async () => {
      const { dto, errors } = await checkCreate({ ...VALID_BODY, lessonPlanId: PLAN_ID });

      expect(errors).toHaveLength(0);
      expect(dto.title).toBe("Teclado, mouse e janelas");
    });

    it("is checked when sent, even with a lessonPlanId: blank, null, too long and not a string", async () => {
      for (const title of ["", "   ", null, "t".repeat(201), 123, ["Teclado"], true]) {
        expect((await checkCreate({ ...VALID_BODY, lessonPlanId: PLAN_ID, title })).fields).toEqual(
          ["title"],
        );
        expect((await checkCreate({ ...VALID_BODY, title })).fields).toEqual(["title"]);
      }
      expect((await checkCreate({ ...VALID_BODY, title: "t".repeat(200) })).errors).toHaveLength(0);
    });

    it("trims the spaces around it", async () => {
      const { dto, errors } = await checkCreate({ ...VALID_BODY, title: "  Teclado e mouse  " });

      expect(errors).toHaveLength(0);
      expect(dto.title).toBe("Teclado e mouse");
    });
  });

  describe("classId and lessonPlanId", () => {
    it("reads both in lower case, so the answer repeats the ids of the database", async () => {
      const { dto, errors } = await checkCreate({
        ...VALID_BODY,
        classId: CLASS_ID.toUpperCase(),
        lessonPlanId: PLAN_ID.toUpperCase(),
      });

      expect(errors).toHaveLength(0);
      expect(dto.classId).toBe(CLASS_ID);
      expect(dto.lessonPlanId).toBe(PLAN_ID);
    });

    it("requires a classId that is a UUID", async () => {
      const { classId: _classId, ...withoutClass } = VALID_BODY;

      expect((await checkCreate(withoutClass)).fields).toEqual(["classId"]);
      for (const classId of [null, "", "not-a-uuid", "123", 123, true, [CLASS_ID], {}]) {
        expect((await checkCreate({ ...VALID_BODY, classId })).fields).toEqual(["classId"]);
      }
    });

    it("takes a lessonPlanId that is a UUID, or nothing: null is the same as omitted", async () => {
      expect((await checkCreate({ ...VALID_BODY, lessonPlanId: null })).errors).toHaveLength(0);
      for (const lessonPlanId of ["", "not-a-uuid", "123", 123, true, [PLAN_ID], {}]) {
        expect((await checkCreate({ ...VALID_BODY, lessonPlanId })).fields).toEqual([
          "lessonPlanId",
        ]);
      }
    });
  });

  describe("sequenceOrder", () => {
    it("rejects a position without a lessonPlanId, on sequenceOrder", async () => {
      const { fields, errors } = await checkCreate({ ...VALID_BODY, sequenceOrder: 1 });

      expect(fields).toEqual(["sequenceOrder"]);
      expect(messagesOf(errors)).toEqual(["sequenceOrder needs a lessonPlanId"]);
    });

    it("rejects a position next to a lessonPlanId that is null", async () => {
      expect(
        (await checkCreate({ ...VALID_BODY, lessonPlanId: null, sequenceOrder: 1 })).fields,
      ).toEqual(["sequenceOrder"]);
    });

    it("accepts a position with a lessonPlanId, from 1 to 1000", async () => {
      for (const sequenceOrder of [1, 2, 50, 1000]) {
        const { dto, errors } = await checkCreate({
          ...VALID_BODY,
          lessonPlanId: PLAN_ID,
          sequenceOrder,
        });

        expect(errors).toHaveLength(0);
        expect(dto.sequenceOrder).toBe(sequenceOrder);
      }
    });

    it("rejects 0, a negative, a fraction, 1001 and a value that is not a number", async () => {
      for (const sequenceOrder of [0, -1, 1.5, 1001, "1", true, [1], {}]) {
        expect(
          (await checkCreate({ ...VALID_BODY, lessonPlanId: PLAN_ID, sequenceOrder })).fields,
        ).toEqual(["sequenceOrder"]);
      }
    });

    it("takes null as omitted, with or without a lessonPlanId", async () => {
      expect((await checkCreate({ ...VALID_BODY, sequenceOrder: null })).errors).toHaveLength(0);
      expect(
        (await checkCreate({ ...VALID_BODY, lessonPlanId: PLAN_ID, sequenceOrder: null })).errors,
      ).toHaveLength(0);
    });
  });

  describe("date, startTime and endTime", () => {
    it("are required", async () => {
      const { date: _date, startTime: _start, endTime: _end, ...bare } = VALID_BODY;

      expect((await checkCreate(bare)).fields).toEqual(["date", "endTime", "startTime"]);
    });

    it("takes a date that exists in the calendar, as YYYY-MM-DD", async () => {
      expect((await checkCreate({ ...VALID_BODY, date: "2028-02-29" })).errors).toHaveLength(0);
      for (const date of [
        "2026-02-30",
        "2026-3-10",
        "10/03/2026",
        "2026-03-10T14:00:00Z",
        "",
        null,
        20260310,
        new Date(),
      ]) {
        expect((await checkCreate({ ...VALID_BODY, date })).fields).toEqual(["date"]);
      }
    });

    it("accepts 00:00 and 23:59", async () => {
      const { errors } = await checkCreate({ ...VALID_BODY, startTime: "00:00", endTime: "23:59" });

      expect(errors).toHaveLength(0);
    });

    it("rejects 24:00, 9:00 and 14:00:00: the shape is exactly HH:mm", async () => {
      for (const time of ["24:00", "9:00", "14:00:00", "14h00", "12:60", "", null, 1400]) {
        expect((await checkCreate({ ...VALID_BODY, startTime: time })).fields).toEqual([
          "startTime",
        ]);
        expect((await checkCreate({ ...VALID_BODY, endTime: time })).fields).toEqual(["endTime"]);
      }
    });

    it("explains a time that is not HH:mm by what it expects", async () => {
      const { errors } = await checkCreate({ ...VALID_BODY, startTime: "9:00" });

      expect(messagesOf(errors)).toEqual(["startTime must be a time in HH:mm format"]);
    });

    it("does not compare the two times: the order is the rule of the service (INVALID_TIME_RANGE)", async () => {
      const { errors } = await checkCreate({ ...VALID_BODY, startTime: "16:00", endTime: "15:00" });

      expect(errors).toHaveLength(0);
    });
  });

  describe("expectedStudents and expectedMonitors", () => {
    it("accept 0, a number up to the limit and null", async () => {
      for (const body of [
        { expectedStudents: 0, expectedMonitors: 0 },
        { expectedStudents: 1000, expectedMonitors: 100 },
        { expectedStudents: null, expectedMonitors: null },
      ]) {
        const { dto, errors } = await checkCreate({ ...VALID_BODY, ...body });

        expect(errors).toHaveLength(0);
        expect(dto.expectedStudents).toBe(body.expectedStudents);
        expect(dto.expectedMonitors).toBe(body.expectedMonitors);
      }
    });

    it("rejects negative and fractional values, a number above the limit and a value that is not a number", async () => {
      for (const value of [-1, 1.5, "10", true, [1], {}]) {
        expect((await checkCreate({ ...VALID_BODY, expectedStudents: value })).fields).toEqual([
          "expectedStudents",
        ]);
        expect((await checkCreate({ ...VALID_BODY, expectedMonitors: value })).fields).toEqual([
          "expectedMonitors",
        ]);
      }
      expect((await checkCreate({ ...VALID_BODY, expectedStudents: 1001 })).fields).toEqual([
        "expectedStudents",
      ]);
      expect((await checkCreate({ ...VALID_BODY, expectedMonitors: 101 })).fields).toEqual([
        "expectedMonitors",
      ]);
    });
  });

  describe("objective, location and subject", () => {
    it("trim the text, and blank means null", async () => {
      const { dto, errors } = await checkCreate({
        ...VALID_BODY,
        objective: "  Objetivo  ",
        location: "  Sala 2  ",
        subject: "",
      });

      expect(errors).toHaveLength(0);
      expect(dto.objective).toBe("Objetivo");
      expect(dto.location).toBe("Sala 2");
      expect(dto.subject).toBeNull();

      const blank = await checkCreate({ ...VALID_BODY, objective: "   ", location: "   " });
      expect(blank.dto.objective).toBeNull();
      expect(blank.dto.location).toBeNull();
    });

    it("accept null", async () => {
      const { dto, errors } = await checkCreate({
        ...VALID_BODY,
        objective: null,
        location: null,
        subject: null,
      });

      expect(errors).toHaveLength(0);
      expect(dto.objective).toBeNull();
      expect(dto.location).toBeNull();
      expect(dto.subject).toBeNull();
    });

    it("reject a text that is too long and a value that is not a string", async () => {
      expect((await checkCreate({ ...VALID_BODY, objective: "o".repeat(2001) })).fields).toEqual([
        "objective",
      ]);
      expect((await checkCreate({ ...VALID_BODY, objective: "o".repeat(2000) })).errors).toEqual(
        [],
      );
      expect((await checkCreate({ ...VALID_BODY, location: "l".repeat(201) })).fields).toEqual([
        "location",
      ]);
      expect((await checkCreate({ ...VALID_BODY, subject: "s".repeat(201) })).fields).toEqual([
        "subject",
      ]);
      for (const value of [123, true, ["a"], {}]) {
        expect((await checkCreate({ ...VALID_BODY, objective: value })).fields).toEqual([
          "objective",
        ]);
        expect((await checkCreate({ ...VALID_BODY, location: value })).fields).toEqual([
          "location",
        ]);
        expect((await checkCreate({ ...VALID_BODY, subject: value })).fields).toEqual(["subject"]);
      }
    });
  });

  it("drops the fields the client has no say in: the status, the notes and the audit columns", async () => {
    const { dto, errors } = await checkCreate({
      ...VALID_BODY,
      status: "done",
      postNotes: "Notas.",
      cancelReason: "x",
      cancelledAt: "2026-03-01T00:00:00Z",
      originalDate: "2026-03-01",
      createdById: "x",
      id: "x",
    });

    expect(errors).toHaveLength(0);
    for (const field of [
      "status",
      "postNotes",
      "cancelReason",
      "cancelledAt",
      "originalDate",
      "createdById",
      "id",
    ]) {
      expect(dto).not.toHaveProperty(field);
    }
  });

  it("reports every field that is wrong at once", async () => {
    const { fields } = await checkCreate({
      classId: "nope",
      date: "nope",
      startTime: "nope",
      endTime: "nope",
    });

    expect(fields).toEqual(["classId", "date", "endTime", "startTime", "title"]);
  });
});

describe("UpdateLessonDto", () => {
  it("accepts an empty body and a partial body", async () => {
    const empty = await checkUpdate({});
    expect(empty.errors).toHaveLength(0);
    expect(empty.dto.title).toBeUndefined();
    expect(empty.dto.status).toBeUndefined();
    expect(empty.dto.location).toBeUndefined();

    const { dto, errors } = await checkUpdate({ location: "  Sala 2  ", expectedStudents: 12 });
    expect(errors).toHaveLength(0);
    expect(dto.location).toBe("Sala 2");
    expect(dto.expectedStudents).toBe(12);
    expect(dto.title).toBeUndefined();
  });

  it("accepts every editable field", async () => {
    const { dto, errors } = await checkUpdate({
      title: "Novo título",
      objective: "Novo objetivo.",
      location: "Sala 2",
      expectedStudents: 12,
      expectedMonitors: 3,
      subject: "Assunto",
      postNotes: "A turma terminou antes do previsto.",
      status: "confirmed",
    });

    expect(errors).toHaveLength(0);
    expect(dto.title).toBe("Novo título");
    expect(dto.objective).toBe("Novo objetivo.");
    expect(dto.location).toBe("Sala 2");
    expect(dto.expectedStudents).toBe(12);
    expect(dto.expectedMonitors).toBe(3);
    expect(dto.subject).toBe("Assunto");
    expect(dto.postNotes).toBe("A turma terminou antes do previsto.");
    expect(dto.status).toBe(LessonStatus.CONFIRMED);
  });

  it("rejects null for the title and the status", async () => {
    expect((await checkUpdate({ title: null, status: null })).fields).toEqual(["status", "title"]);
  });

  it("accepts null for the fields that clear, and a blank string means the same", async () => {
    const nothing = await checkUpdate({
      objective: null,
      location: null,
      expectedStudents: null,
      expectedMonitors: null,
      subject: null,
      postNotes: null,
    });
    expect(nothing.errors).toHaveLength(0);
    expect(nothing.dto.objective).toBeNull();
    expect(nothing.dto.location).toBeNull();
    expect(nothing.dto.expectedStudents).toBeNull();
    expect(nothing.dto.expectedMonitors).toBeNull();
    expect(nothing.dto.subject).toBeNull();
    expect(nothing.dto.postNotes).toBeNull();

    const blank = await checkUpdate({ objective: "  ", location: "", subject: " ", postNotes: "" });
    expect(blank.errors).toHaveLength(0);
    expect(blank.dto.objective).toBeNull();
    expect(blank.dto.location).toBeNull();
    expect(blank.dto.subject).toBeNull();
    expect(blank.dto.postNotes).toBeNull();
  });

  it("accepts planned, confirmed and done as the status", async () => {
    for (const status of ["planned", "confirmed", "done"]) {
      const { dto, errors } = await checkUpdate({ status });

      expect(errors).toHaveLength(0);
      expect(dto.status).toBe(status);
    }
  });

  it("rejects status cancelled, which only cancelLesson sets, and any other value", async () => {
    const cancelled = await checkUpdate({ status: "cancelled" });
    expect(cancelled.fields).toEqual(["status"]);
    expect(messagesOf(cancelled.errors)).toEqual([
      "status must be one of the following values: planned, confirmed, done",
    ]);

    for (const status of ["open", "CANCELLED", "Done", "", 1, true, ["done"]]) {
      expect((await checkUpdate({ status })).fields).toEqual(["status"]);
    }
  });

  it("applies the same rules as the create body to the fields sent", async () => {
    expect((await checkUpdate({ title: "   " })).fields).toEqual(["title"]);
    expect((await checkUpdate({ title: "t".repeat(201) })).fields).toEqual(["title"]);
    expect((await checkUpdate({ title: "t".repeat(200) })).errors).toHaveLength(0);
    expect((await checkUpdate({ objective: "o".repeat(2001) })).fields).toEqual(["objective"]);
    expect((await checkUpdate({ location: "l".repeat(201) })).fields).toEqual(["location"]);
    expect((await checkUpdate({ subject: "s".repeat(201) })).fields).toEqual(["subject"]);
    expect((await checkUpdate({ postNotes: "n".repeat(5001) })).fields).toEqual(["postNotes"]);
    expect((await checkUpdate({ postNotes: "n".repeat(5000) })).errors).toHaveLength(0);
    expect((await checkUpdate({ expectedStudents: -1 })).fields).toEqual(["expectedStudents"]);
    expect((await checkUpdate({ expectedStudents: 1.5 })).fields).toEqual(["expectedStudents"]);
    expect((await checkUpdate({ expectedStudents: 1001 })).fields).toEqual(["expectedStudents"]);
    expect((await checkUpdate({ expectedMonitors: -1 })).fields).toEqual(["expectedMonitors"]);
    expect((await checkUpdate({ expectedMonitors: 101 })).fields).toEqual(["expectedMonitors"]);
    expect((await checkUpdate({ expectedMonitors: "2" })).fields).toEqual(["expectedMonitors"]);
  });

  it("trims the title", async () => {
    const { dto, errors } = await checkUpdate({ title: "  Novo título  " });

    expect(errors).toHaveLength(0);
    expect(dto.title).toBe("Novo título");
  });

  it("drops date, startTime, endTime, classId, lessonPlanId and sequenceOrder: they are not editable", async () => {
    const { dto, errors } = await checkUpdate({
      title: "Novo título",
      date: "2026-03-17",
      startTime: "09:00",
      endTime: "10:00",
      classId: CLASS_ID,
      lessonPlanId: PLAN_ID,
      sequenceOrder: 4,
    });

    expect(errors).toHaveLength(0);
    expect(dto.title).toBe("Novo título");
    for (const field of [
      "date",
      "startTime",
      "endTime",
      "classId",
      "lessonPlanId",
      "sequenceOrder",
    ]) {
      expect(dto).not.toHaveProperty(field);
    }
  });

  it("does not validate what it drops: a bad date or a bad time is ignored, not rejected", async () => {
    const { dto, errors } = await checkUpdate({
      date: "not-a-date",
      startTime: "25:99",
      classId: "not-a-uuid",
      lessonPlanId: "not-a-uuid",
      sequenceOrder: 0,
    });

    expect(errors).toHaveLength(0);
    expect(dto).not.toHaveProperty("date");
    expect(dto).not.toHaveProperty("startTime");
    expect(dto).not.toHaveProperty("classId");
    expect(dto).not.toHaveProperty("lessonPlanId");
    expect(dto).not.toHaveProperty("sequenceOrder");
  });

  it("drops the fields the client has no say in", async () => {
    const { dto, errors } = await checkUpdate({
      cancelReason: "x",
      cancelledAt: "2026-03-01T00:00:00Z",
      cancelledById: "x",
      originalDate: "2026-03-01",
      rescheduleReason: "x",
      rescheduleNote: "x",
      createdById: "x",
      id: "x",
    });

    expect(errors).toHaveLength(0);
    for (const field of [
      "cancelReason",
      "cancelledAt",
      "cancelledById",
      "originalDate",
      "rescheduleReason",
      "rescheduleNote",
      "createdById",
      "id",
    ]) {
      expect(dto).not.toHaveProperty(field);
    }
  });
});

describe("CancelLessonDto", () => {
  it("accepts a reason and trims it", async () => {
    const { dto, errors } = await checkCancel({ reason: "  Feriado municipal.  " });

    expect(errors).toHaveLength(0);
    expect(dto.reason).toBe("Feriado municipal.");
  });

  it("rejects a missing, empty or blank reason", async () => {
    expect((await checkCancel({})).fields).toEqual(["reason"]);
    for (const reason of ["", " ", "   ", "\n\t", null, undefined]) {
      expect((await checkCancel({ reason })).fields).toEqual(["reason"]);
    }
  });

  it("rejects a reason that is not a string", async () => {
    for (const reason of [123, true, ["Feriado"], { text: "Feriado" }]) {
      expect((await checkCancel({ reason })).fields).toEqual(["reason"]);
    }
  });

  it("accepts a reason of 500 characters and rejects one of 501", async () => {
    expect((await checkCancel({ reason: "r".repeat(500) })).errors).toHaveLength(0);
    expect((await checkCancel({ reason: "r".repeat(501) })).fields).toEqual(["reason"]);
  });

  it("drops everything but the reason", async () => {
    const { dto, errors } = await checkCancel({
      reason: "Feriado.",
      status: "cancelled",
      cancelledAt: "2026-03-01T00:00:00Z",
      cancelledById: "x",
    });

    expect(errors).toHaveLength(0);
    expect(dto).not.toHaveProperty("status");
    expect(dto).not.toHaveProperty("cancelledAt");
    expect(dto).not.toHaveProperty("cancelledById");
  });
});

describe("RescheduleLessonDto", () => {
  const VALID_RESCHEDULE = { date: "2026-03-17", startTime: "14:00", endTime: "15:30" };

  it("requires date, startTime and endTime", async () => {
    expect((await checkReschedule({})).fields).toEqual(["date", "endTime", "startTime"]);
    expect((await checkReschedule({ date: "2026-03-17" })).fields).toEqual([
      "endTime",
      "startTime",
    ]);
    expect((await checkReschedule({ startTime: "14:00", endTime: "15:30" })).fields).toEqual([
      "date",
    ]);
  });

  it("accepts the new schedule alone: the place, the reason and the note are optional", async () => {
    const { dto, errors } = await checkReschedule(VALID_RESCHEDULE);

    expect(errors).toHaveLength(0);
    expect(dto.date).toBe("2026-03-17");
    expect(dto.startTime).toBe("14:00");
    expect(dto.endTime).toBe("15:30");
    expect(dto.location).toBeUndefined();
    expect(dto.reason).toBeUndefined();
    expect(dto.note).toBeUndefined();
  });

  it("accepts every optional field, trimmed", async () => {
    const { dto, errors } = await checkReschedule({
      ...VALID_RESCHEDULE,
      location: "  Laboratório 2  ",
      reason: "  Laboratório em manutenção.  ",
      note: "  Avisar a turma pelo grupo.  ",
    });

    expect(errors).toHaveLength(0);
    expect(dto.location).toBe("Laboratório 2");
    expect(dto.reason).toBe("Laboratório em manutenção.");
    expect(dto.note).toBe("Avisar a turma pelo grupo.");
  });

  it("takes null or a blank string for the place, the reason and the note as null", async () => {
    const nothing = await checkReschedule({
      ...VALID_RESCHEDULE,
      location: null,
      reason: null,
      note: null,
    });
    expect(nothing.errors).toHaveLength(0);
    expect(nothing.dto.location).toBeNull();
    expect(nothing.dto.reason).toBeNull();
    expect(nothing.dto.note).toBeNull();

    const blank = await checkReschedule({
      ...VALID_RESCHEDULE,
      location: " ",
      reason: "",
      note: "  ",
    });
    expect(blank.errors).toHaveLength(0);
    expect(blank.dto.location).toBeNull();
    expect(blank.dto.reason).toBeNull();
    expect(blank.dto.note).toBeNull();
  });

  it("rejects a date that does not exist and a time that is not HH:mm", async () => {
    expect((await checkReschedule({ ...VALID_RESCHEDULE, date: "2026-02-30" })).fields).toEqual([
      "date",
    ]);
    expect((await checkReschedule({ ...VALID_RESCHEDULE, date: "17/03/2026" })).fields).toEqual([
      "date",
    ]);
    for (const time of ["24:00", "9:00", "14:00:00", "", null, 1400]) {
      expect((await checkReschedule({ ...VALID_RESCHEDULE, startTime: time })).fields).toEqual([
        "startTime",
      ]);
      expect((await checkReschedule({ ...VALID_RESCHEDULE, endTime: time })).fields).toEqual([
        "endTime",
      ]);
    }
  });

  it("does not compare the two times: the order is the rule of the service (INVALID_TIME_RANGE)", async () => {
    const { errors } = await checkReschedule({
      ...VALID_RESCHEDULE,
      startTime: "16:00",
      endTime: "15:00",
    });

    expect(errors).toHaveLength(0);
  });

  it("rejects texts that are too long or not strings", async () => {
    expect(
      (await checkReschedule({ ...VALID_RESCHEDULE, location: "l".repeat(201) })).fields,
    ).toEqual(["location"]);
    expect(
      (await checkReschedule({ ...VALID_RESCHEDULE, reason: "r".repeat(501) })).fields,
    ).toEqual(["reason"]);
    expect(
      (await checkReschedule({ ...VALID_RESCHEDULE, reason: "r".repeat(500) })).errors,
    ).toEqual([]);
    expect((await checkReschedule({ ...VALID_RESCHEDULE, note: "n".repeat(2001) })).fields).toEqual(
      ["note"],
    );
    expect((await checkReschedule({ ...VALID_RESCHEDULE, note: "n".repeat(2000) })).errors).toEqual(
      [],
    );
    for (const value of [123, true, ["a"], {}]) {
      expect((await checkReschedule({ ...VALID_RESCHEDULE, location: value })).fields).toEqual([
        "location",
      ]);
      expect((await checkReschedule({ ...VALID_RESCHEDULE, reason: value })).fields).toEqual([
        "reason",
      ]);
      expect((await checkReschedule({ ...VALID_RESCHEDULE, note: value })).fields).toEqual([
        "note",
      ]);
    }
  });

  it("drops the fields a reschedule does not take: the class, the status and the original date", async () => {
    const { dto, errors } = await checkReschedule({
      ...VALID_RESCHEDULE,
      classId: CLASS_ID,
      status: "cancelled",
      originalDate: "2026-01-01",
      title: "Outro título",
    });

    expect(errors).toHaveLength(0);
    for (const field of ["classId", "status", "originalDate", "title"]) {
      expect(dto).not.toHaveProperty(field);
    }
  });
});
