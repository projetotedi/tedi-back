import "reflect-metadata";
import { HttpException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Readable } from "node:stream";
import { DataSource } from "typeorm";
import { MembersService } from "@modules/people/services/members.service";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { Role } from "@shared/enums/role.enum";
import { Permission } from "@shared/permissions/permission.enum";
import { HourEntry } from "../entities/hour-entry.entity";
import { HourEntryCategory } from "../enums/hour-entry-category.enum";
import { HourEntryOrigin } from "../enums/hour-entry-origin.enum";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";
import { EVERYONE, peoplePopulation } from "../services/hour-entry-queries";
import { CSV_BOM, csvLine, HOURS_CSV_HEADER, HOURS_EXPORT_BATCH_SIZE } from "../services/hours-csv";
import { HoursExportService } from "../services/hours-export.service";
import { HoursScopeService } from "../services/hours-scope.service";

const ANA = "01999a3e-0000-7000-8000-0000000000a1";
const BRUNO = "01999a3e-0000-7000-8000-0000000000a2";
const CARLA = "01999a3e-0000-7000-8000-0000000000a3";
const TECH = "01999a3e-1111-7000-8000-000000000001";
const AT = new Date("2026-03-10T21:00:00.000Z");

const COORDINATOR: AuthUser = {
  id: "01999a3e-0000-7000-8000-0000000000ee",
  role: Role.COORDINATOR,
  accessEnabled: true,
  departmentIds: [],
};

const HEADER = CSV_BOM + csvLine(HOURS_CSV_HEADER);

/** A pending entry with an id made from `index`, so ids grow with it. */
function entryOf(index: number, personId: string, date = "2026-03-10"): HourEntry {
  return Object.assign(new HourEntry(), {
    id: `01999a3e-7c1b-7000-8000-${index.toString(16).padStart(12, "0")}`,
    personId,
    createdById: personId,
    origin: HourEntryOrigin.MANUAL,
    activity: `Planejamento ${index}`,
    category: HourEntryCategory.PLANNING,
    date,
    declaredMinutes: 60,
    validatedMinutes: null,
    notes: null,
    status: HourEntryStatus.PENDING,
    classId: null,
    lessonId: null,
    reviewNote: null,
    reviewedById: null,
    reviewedAt: null,
    createdAt: AT,
    updatedAt: AT,
    deletedAt: null,
  });
}

function batchOf(size: number, personIdOf: (index: number) => string, from = 0): HourEntry[] {
  return Array.from({ length: size }, (_, index) =>
    entryOf(from + index, personIdOf(from + index)),
  );
}

async function textOf(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

describe("HoursExportService", () => {
  let service: HoursExportService;

  const builder = {
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    limit: jest.fn(),
    getMany: jest.fn(),
  };
  const entryRepository = { createQueryBuilder: jest.fn() };
  const dataSource = { getRepository: jest.fn() };
  const scope = { populationOf: jest.fn() };
  const members = { findMemberRefs: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    for (const method of [builder.andWhere, builder.orderBy, builder.addOrderBy, builder.limit]) {
      method.mockReturnValue(builder);
    }
    builder.getMany.mockResolvedValue([]);
    entryRepository.createQueryBuilder.mockReturnValue(builder);
    dataSource.getRepository.mockImplementation((target: unknown) =>
      target === HourEntry ? entryRepository : undefined,
    );
    scope.populationOf.mockResolvedValue(EVERYONE);
    members.findMemberRefs.mockImplementation(async ({ ids }: { ids: string[] }) =>
      ids
        .filter((id) => id !== CARLA)
        .map((id) => ({
          id,
          name: `Pessoa ${id.slice(-2)}`,
          department: { id: TECH, name: "Tecnologia" },
        })),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        HoursExportService,
        { provide: DataSource, useValue: dataSource },
        { provide: HoursScopeService, useValue: scope },
        { provide: MembersService, useValue: members },
      ],
    }).compile();
    service = moduleRef.get(HoursExportService);
  });

  it("throws INVALID_PERIOD before resolving the scope or creating the stream", async () => {
    const failure: unknown = await service
      .exportCsv(COORDINATOR, { from: "2026-03-31", to: "2026-03-01" })
      .catch((error: unknown) => error);

    if (!(failure instanceof HttpException)) throw new Error("Expected an HttpException");
    expect(failure.getStatus()).toBe(400);
    expect(failure.getResponse()).toMatchObject({ error: "INVALID_PERIOD" });
    expect(scope.populationOf).not.toHaveBeenCalled();
  });

  it("resolves the scope of hours.export before the stream, and reads nothing until the stream is read", async () => {
    await service.exportCsv(COORDINATOR, {});

    expect(scope.populationOf).toHaveBeenCalledWith(COORDINATOR, Permission.HOURS_EXPORT);
    expect(dataSource.getRepository).not.toHaveBeenCalled();
  });

  it("starts the file with the BOM and the header line, then one line per entry", async () => {
    builder.getMany.mockResolvedValueOnce([entryOf(1, ANA), entryOf(2, CARLA)]);

    const file = await service.exportCsv(COORDINATOR, {});
    const text = await textOf(file.stream);

    expect(text.startsWith(HEADER)).toBe(true);
    const lines = text.slice(CSV_BOM.length).split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain(`"Pessoa a1";"Tecnologia"`);
    expect(lines[2]).toContain(`"${CARLA}";"";""`);
    expect(lines[3]).toBe("");
  });

  it("reads the entries in batches of HOURS_EXPORT_BATCH_SIZE ordered by date and id, continuing after the last row, until a short batch", async () => {
    const full = batchOf(HOURS_EXPORT_BATCH_SIZE, () => ANA);
    builder.getMany
      .mockResolvedValueOnce(full)
      .mockResolvedValueOnce([entryOf(9999, ANA, "2026-03-11")]);

    const text = await textOf((await service.exportCsv(COORDINATOR, {})).stream);

    expect(HOURS_EXPORT_BATCH_SIZE).toBe(500);
    expect(builder.getMany).toHaveBeenCalledTimes(2);
    expect(builder.limit.mock.calls).toEqual([[500], [500]]);
    expect(builder.orderBy).toHaveBeenCalledWith("entry.date", "ASC");
    expect(builder.addOrderBy).toHaveBeenCalledWith("entry.id", "ASC");
    const last = full[full.length - 1];
    expect(builder.andWhere.mock.calls).toEqual([
      [
        "(entry.date > :afterDate OR (entry.date = :afterDate AND entry.id > :afterId))",
        { afterDate: last.date, afterId: last.id },
      ],
    ]);
    expect(text.slice(CSV_BOM.length).split("\r\n")).toHaveLength(1 + 501 + 1);
  });

  it("stops after an empty batch when the last one was full", async () => {
    builder.getMany.mockResolvedValueOnce(batchOf(HOURS_EXPORT_BATCH_SIZE, () => ANA));

    const text = await textOf((await service.exportCsv(COORDINATOR, {})).stream);

    expect(builder.getMany).toHaveBeenCalledTimes(2);
    expect(text.slice(CSV_BOM.length).split("\r\n")).toHaveLength(1 + 500 + 1);
  });

  it("names the people of each batch with findMemberRefs, asking only the ids not seen before", async () => {
    builder.getMany
      .mockResolvedValueOnce(
        batchOf(HOURS_EXPORT_BATCH_SIZE, (index) => (index % 2 === 0 ? ANA : BRUNO)),
      )
      .mockResolvedValueOnce([entryOf(600, BRUNO), entryOf(601, CARLA), entryOf(602, CARLA)]);

    await textOf((await service.exportCsv(COORDINATOR, {})).stream);

    expect(members.findMemberRefs.mock.calls).toEqual([
      [{ ids: [ANA, BRUNO] }],
      [{ ids: [CARLA] }],
    ]);
  });

  it("writes only the header for a population of nobody, without querying", async () => {
    scope.populationOf.mockResolvedValue(peoplePopulation([]));

    const text = await textOf((await service.exportCsv(COORDINATOR, {})).stream);

    expect(text).toBe(HEADER);
    expect(dataSource.getRepository).not.toHaveBeenCalled();
    expect(members.findMemberRefs).not.toHaveBeenCalled();
  });

  it("restricts the entries to the population and the period", async () => {
    scope.populationOf.mockResolvedValue(peoplePopulation([ANA, BRUNO]));

    await textOf(
      (await service.exportCsv(COORDINATOR, { from: "2026-03-01", to: "2026-03-31" })).stream,
    );

    expect(builder.andWhere.mock.calls).toEqual([
      ["entry.date >= :from", { from: "2026-03-01" }],
      ["entry.date <= :to", { to: "2026-03-31" }],
      ["entry.person_id IN (:...personIds)", { personIds: [ANA, BRUNO] }],
    ]);
  });

  it("names the file after the period", async () => {
    const file = await service.exportCsv(COORDINATOR, { from: "2026-03-01", to: "2026-03-31" });

    expect(file.fileName).toBe("hours_2026-03-01_2026-03-31.csv");
  });

  it("fails the stream when a batch fails, after the header", async () => {
    const failure = new Error("connection lost");
    builder.getMany.mockRejectedValueOnce(failure);

    const file = await service.exportCsv(COORDINATOR, {});

    await expect(textOf(file.stream)).rejects.toBe(failure);
  });
});
