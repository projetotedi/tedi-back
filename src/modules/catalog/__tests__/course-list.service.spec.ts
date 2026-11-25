import { DataSource } from "typeorm";
import { CourseCategory } from "../enums/course-category.enum";
import { CourseListRow } from "../services/course-list.mapper";
import { CourseListService } from "../services/course-list.service";

const CREATED_AT = new Date("2026-09-01T12:00:00.000Z");

function row(id: string, name: string): CourseListRow {
  return {
    id,
    name,
    category: CourseCategory.BASIC,
    archivedAt: null,
    createdAt: CREATED_AT,
    lessonPlanCount: 0,
    plannedWorkloadMinutes: 0,
  };
}

/** A query builder whose every chained call returns itself; only the terminal calls answer. */
function chainableBuilder(rows: CourseListRow[], total: number) {
  const builder: Record<string, jest.Mock> = {};
  const chain = jest.fn(() => builder);
  for (const method of [
    "leftJoin",
    "select",
    "addSelect",
    "andWhere",
    "orderBy",
    "addOrderBy",
    "offset",
    "limit",
    "clone",
    "getParameters",
    "setParameters",
  ]) {
    builder[method] = chain;
  }
  builder.getParameters = jest.fn(() => ({}));
  builder.getRawMany = jest.fn(async () => rows);
  builder.getCount = jest.fn(async () => total);
  return builder;
}

describe("CourseListService", () => {
  function setup(rows: CourseListRow[], total: number) {
    const builder = chainableBuilder(rows, total);
    const dataSource = {
      getRepository: jest.fn(() => ({ createQueryBuilder: jest.fn(() => builder) })),
      query: jest.fn(async (_sql: string, _parameters: unknown[]) => [
        { courseId: "course-2", id: "course-1", name: "Informática Básica" },
      ]),
    };
    const service = new CourseListService(dataSource as unknown as DataSource);
    return { service, builder, dataSource };
  }

  it("does not read prerequisites for an empty page", async () => {
    const { service, dataSource } = setup([], 3);

    const result = await service.list({ page: 9 });

    expect(result).toEqual({ data: [], total: 3, page: 9, limit: 20 });
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it("reads the prerequisites of the whole page in one query and attaches them by course", async () => {
    const { service, dataSource } = setup(
      [row("course-1", "Informática Básica"), row("course-2", "Informática Intermediária")],
      2,
    );

    const result = await service.list({});

    expect(dataSource.query).toHaveBeenCalledTimes(1);
    expect(dataSource.query.mock.calls[0][1]).toEqual([["course-1", "course-2"]]);
    expect(result.data.map((item) => item.prerequisites)).toEqual([
      [],
      [{ id: "course-1", name: "Informática Básica" }],
    ]);
  });

  it("pages with the normalized page and limit", async () => {
    const { service, builder } = setup([], 0);

    await service.list({ page: 3, limit: 10 });

    expect(builder.offset).toHaveBeenCalledWith(20);
    expect(builder.limit).toHaveBeenCalledWith(10);
  });
});
