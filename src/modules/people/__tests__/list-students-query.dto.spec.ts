import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  ANY_ACCESSIBILITY_NEED,
  ListStudentsQueryDto,
  STUDENT_LIST_MAX_IDS,
} from "../dto/list-students-query.dto";
import { AccessibilityNeed } from "../enums/accessibility-need.enum";
import { StudentListSort } from "../enums/student-list-sort.enum";

const STUDENT_ID = "01999a3e-7c1b-7000-8000-000000000001";
const OTHER_STUDENT_ID = "01999a3e-7c1b-7000-8000-000000000002";

/** `count` distinct, well formed ids. */
function ids(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `01999a3e-7c1b-7000-8000-${String(index).padStart(12, "0")}`,
  );
}

async function parse(query: Record<string, unknown>) {
  const dto = plainToInstance(ListStudentsQueryDto, query);
  const errors = await validate(dto, { whitelist: true });
  return { dto, fields: errors.map((error) => error.property).sort() };
}

describe("ListStudentsQueryDto", () => {
  it("accepts an empty query", async () => {
    const { dto, fields } = await parse({});

    expect(fields).toEqual([]);
    expect(dto.accessibilityNeed).toBeUndefined();
    expect(dto.ids).toBeUndefined();

    // A key that comes as undefined stays undefined: the transforms never turn it into NaN or [].
    const undefinedKeys = await parse({
      page: undefined,
      limit: undefined,
      accessibilityNeed: undefined,
      ids: undefined,
    });
    expect(undefinedKeys.fields).toEqual([]);
    expect(undefinedKeys.dto).toMatchObject({
      page: undefined,
      limit: undefined,
      accessibilityNeed: undefined,
      ids: undefined,
    });
  });

  it("turns the query strings into numbers, a boolean, the sort and the lists of accessibilityNeed and ids", async () => {
    const { dto, fields } = await parse({
      page: "2",
      limit: "10",
      search: "maria",
      accessibilityNeed: "visual, hearing",
      ids: `${STUDENT_ID}, ${OTHER_STUDENT_ID}`,
      archived: "true",
      sort: "createdAt",
    });

    expect(fields).toEqual([]);
    expect(dto).toMatchObject({
      page: 2,
      limit: 10,
      search: "maria",
      accessibilityNeed: [AccessibilityNeed.VISUAL, AccessibilityNeed.HEARING],
      ids: [STUDENT_ID, OTHER_STUDENT_ID],
      archived: true,
      sort: StudentListSort.CREATED_AT,
    });
    expect((await parse({ archived: "false" })).dto.archived).toBe(false);
  });

  it("reads a repeated accessibilityNeed, keeps each value once and takes any and none", async () => {
    const repeated = await parse({ accessibilityNeed: ["any", "none,any"] });
    expect(repeated.fields).toEqual([]);
    expect(repeated.dto.accessibilityNeed).toEqual([
      ANY_ACCESSIBILITY_NEED,
      AccessibilityNeed.NONE,
    ]);

    // An empty accessibilityNeed is an empty list: it filters nothing, as status= in the classes.
    const empty = await parse({ accessibilityNeed: "" });
    expect(empty.fields).toEqual([]);
    expect(empty.dto.accessibilityNeed).toEqual([]);

    const repeatedIds = await parse({ ids: [STUDENT_ID, `${STUDENT_ID},${OTHER_STUDENT_ID}`] });
    expect(repeatedIds.fields).toEqual([]);
    expect(repeatedIds.dto.ids).toEqual([STUDENT_ID, OTHER_STUDENT_ID]);
  });

  it.each([
    ["accessibilityNeed=blind", "accessibilityNeed", { accessibilityNeed: "blind" }],
    ["accessibilityNeed=visual,blind", "accessibilityNeed", { accessibilityNeed: "visual,blind" }],
    ["an accessibilityNeed that is not text", "accessibilityNeed", { accessibilityNeed: 3 }],
    ["ids=abc", "ids", { ids: "abc" }],
    ["ids=<uuid>,abc", "ids", { ids: `${STUDENT_ID},abc` }],
    ["ids= (empty)", "ids", { ids: "" }],
    ['ids=" , "', "ids", { ids: " , " }],
    ["101 ids", "ids", { ids: ids(STUDENT_LIST_MAX_IDS + 1).join(",") }],
    ["archived=yes", "archived", { archived: "yes" }],
    ["sort=age", "sort", { sort: "age" }],
    ["limit=101", "limit", { limit: "101" }],
    ["page=0", "page", { page: "0" }],
    ["a search of 101 characters", "search", { search: "x".repeat(101) }],
  ])("rejects %s in %s", async (_case, field, query) => {
    const { fields } = await parse(query);

    expect(fields).toEqual([field]);
  });

  it("accepts exactly STUDENT_LIST_MAX_IDS ids", async () => {
    const { dto, fields } = await parse({ ids: ids(STUDENT_LIST_MAX_IDS).join(",") });

    expect(fields).toEqual([]);
    expect(dto.ids).toHaveLength(STUDENT_LIST_MAX_IDS);
  });
});
