import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate, ValidationError } from "class-validator";
import { flattenValidationErrors } from "@shared/filters/http-exception.filter";
import { ClassesSummaryByCourseQueryDto } from "../dto/classes-summary-by-course-query.dto";
import { CLASSES_SUMMARY_MAX_COURSES } from "../dto/class-limits";
import { ListCourseClassesQueryDto } from "../dto/list-course-classes-query.dto";
import { ClassStatus } from "../enums/class-status.enum";

const BASIC_ID = "01999a3e-7c1b-7000-8000-000000000001";
const SMARTPHONES_ID = "01999a3e-7c1b-7000-8000-000000000002";
const ADVANCED_ID = "01999a3e-7c1b-7000-8000-000000000003";

function fieldsOf(errors: ValidationError[]): string[] {
  return errors.map((error) => error.property).sort();
}

function messagesOf(errors: ValidationError[]): string[] {
  return flattenValidationErrors(errors).map((error) => error.message);
}

async function checkSummary(query: Record<string, unknown>) {
  const dto = plainToInstance(ClassesSummaryByCourseQueryDto, query);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: fieldsOf(errors) };
}

async function checkList(query: Record<string, unknown>) {
  const dto = plainToInstance(ListCourseClassesQueryDto, query);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors, fields: fieldsOf(errors) };
}

/** `count` distinct, well formed ids. */
function ids(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `01999a3e-7c1b-7000-8000-${String(index).padStart(12, "0")}`,
  );
}

describe("ClassesSummaryByCourseQueryDto", () => {
  it("splits a,b,c, trims, lower-cases and drops empties", async () => {
    const { dto, errors } = await checkSummary({
      courseIds: ` ${BASIC_ID.toUpperCase()} ,${SMARTPHONES_ID},, ${ADVANCED_ID} ,`,
    });

    expect(errors).toHaveLength(0);
    expect(dto.courseIds).toEqual([BASIC_ID, SMARTPHONES_ID, ADVANCED_ID]);
  });

  it("accepts one id, and the comma separated text of two", async () => {
    const one = await checkSummary({ courseIds: BASIC_ID });
    expect(one.errors).toHaveLength(0);
    expect(one.dto.courseIds).toEqual([BASIC_ID]);

    const two = await checkSummary({ courseIds: `${BASIC_ID},${SMARTPHONES_ID}` });
    expect(two.errors).toHaveLength(0);
    expect(two.dto.courseIds).toEqual([BASIC_ID, SMARTPHONES_ID]);
  });

  it("accepts the repeated param form", async () => {
    const { dto, errors } = await checkSummary({
      courseIds: [BASIC_ID, ` ${SMARTPHONES_ID.toUpperCase()}`, `${ADVANCED_ID},${BASIC_ID}`],
    });

    expect(errors).toHaveLength(0);
    // The repeated form and the commas can be mixed; the order is the one received.
    expect(dto.courseIds).toEqual([BASIC_ID, SMARTPHONES_ID, ADVANCED_ID, BASIC_ID]);
  });

  it("keeps a repeated id: the service answers once for it, the DTO does not reject it", async () => {
    const { dto, errors } = await checkSummary({ courseIds: `${BASIC_ID},${BASIC_ID}` });

    expect(errors).toHaveLength(0);
    expect(dto.courseIds).toEqual([BASIC_ID, BASIC_ID]);
  });

  it("rejects missing, empty, a non-UUID item and 101 ids with field courseIds", async () => {
    expect((await checkSummary({})).fields).toEqual(["courseIds"]);

    for (const courseIds of [
      "",
      " ",
      ",",
      " , ,",
      [],
      [""],
      "not-a-uuid",
      `${BASIC_ID},not-a-uuid`,
      [BASIC_ID, "not-a-uuid"],
      `${BASIC_ID}x`,
      "123",
    ]) {
      expect((await checkSummary({ courseIds })).fields).toEqual(["courseIds"]);
    }

    const tooMany = await checkSummary({
      courseIds: ids(CLASSES_SUMMARY_MAX_COURSES + 1).join(","),
    });
    expect(tooMany.fields).toEqual(["courseIds"]);
    expect(messagesOf(tooMany.errors)).toEqual([
      `courseIds must contain no more than ${CLASSES_SUMMARY_MAX_COURSES} elements`,
    ]);
  });

  it("accepts exactly 100 ids", async () => {
    const { dto, errors } = await checkSummary({ courseIds: ids(CLASSES_SUMMARY_MAX_COURSES) });

    expect(errors).toHaveLength(0);
    expect(dto.courseIds).toHaveLength(CLASSES_SUMMARY_MAX_COURSES);
  });

  it("counts the ids after it dropped the empties and not the commas", async () => {
    // 100 ids with a trailing comma and spaces are still 100 ids.
    const { errors } = await checkSummary({
      courseIds: `${ids(CLASSES_SUMMARY_MAX_COURSES).join(" , ")} ,,`,
    });

    expect(errors).toHaveLength(0);
  });

  it("rejects what is neither text nor a list of text", async () => {
    for (const courseIds of [
      null,
      12,
      true,
      { 0: BASIC_ID },
      [BASIC_ID, 12],
      [[BASIC_ID]],
      [null],
      [{ id: BASIC_ID }],
    ]) {
      expect((await checkSummary({ courseIds })).fields).toEqual(["courseIds"]);
    }
  });

  it("explains a missing list by what it expects and a bad item by its kind", async () => {
    expect(messagesOf((await checkSummary({})).errors)).toEqual(["courseIds must be an array"]);
    expect(messagesOf((await checkSummary({ courseIds: "nope" })).errors)).toEqual([
      "each value in courseIds must be a UUID",
    ]);
  });

  it("drops what the client has no say in", async () => {
    const { dto, errors } = await checkSummary({ courseIds: BASIC_ID, status: "planned", x: 1 });

    expect(errors).toHaveLength(0);
    expect(dto).not.toHaveProperty("status");
    expect(dto).not.toHaveProperty("x");
  });
});

describe("ListCourseClassesQueryDto", () => {
  it("accepts an empty query: the page, the limit and the status are optional", async () => {
    const { dto, errors } = await checkList({});

    expect(errors).toHaveLength(0);
    expect(dto.page).toBeUndefined();
    expect(dto.limit).toBeUndefined();
    expect(dto.status).toBeUndefined();
  });

  it("reads page and limit as numbers, and takes any of the four statuses", async () => {
    const { dto, errors } = await checkList({ page: "2", limit: "50", status: "in_progress" });

    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(50);
    expect(dto.status).toBe(ClassStatus.IN_PROGRESS);

    for (const status of Object.values(ClassStatus)) {
      expect((await checkList({ status })).errors).toHaveLength(0);
    }
  });

  it("accepts the limits of the page: 1 to 100", async () => {
    expect((await checkList({ limit: "1" })).errors).toHaveLength(0);
    expect((await checkList({ limit: "100" })).errors).toHaveLength(0);
    expect((await checkList({ page: "1" })).errors).toHaveLength(0);
  });

  it("rejects an unknown status and limit 101", async () => {
    expect((await checkList({ status: "open" })).fields).toEqual(["status"]);
    expect((await checkList({ status: "PLANNED" })).fields).toEqual(["status"]);
    expect((await checkList({ status: "" })).fields).toEqual(["status"]);
    expect((await checkList({ limit: "101" })).fields).toEqual(["limit"]);
  });

  it("rejects page 0, a negative or fractional page or limit, and a text", async () => {
    for (const [field, query] of [
      ["page", { page: "0" }],
      ["page", { page: "-1" }],
      ["page", { page: "1.5" }],
      ["page", { page: "abc" }],
      ["page", { page: "" }],
      ["limit", { limit: "0" }],
      ["limit", { limit: "-5" }],
      ["limit", { limit: "2.5" }],
      ["limit", { limit: "abc" }],
      ["limit", { limit: "" }],
    ] as const) {
      expect((await checkList(query)).fields).toEqual([field]);
    }
  });

  it("reports every invalid parameter at once", async () => {
    const { fields } = await checkList({ page: "0", limit: "101", status: "open" });

    expect(fields).toEqual(["limit", "page", "status"]);
  });

  it("drops a filter that does not exist for this list", async () => {
    const { dto, errors } = await checkList({
      search: "info",
      archived: "true",
      courseId: BASIC_ID,
    });

    expect(errors).toHaveLength(0);
    expect(dto).not.toHaveProperty("search");
    expect(dto).not.toHaveProperty("archived");
    expect(dto).not.toHaveProperty("courseId");
  });
});
