import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { DataSource, EntityManager } from "typeorm";
import { EnrollmentRosterService } from "../services/enrollment-roster.service";

const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const OTHER_CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c2";
const SIGNED_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
const OTHER_SIGNED_ID = "01999a3e-7c1b-7000-8000-0000000000f2";

describe("EnrollmentRosterService", () => {
  let service: EnrollmentRosterService;

  const plainManager = { query: jest.fn() };
  const transaction = { query: jest.fn() };
  const dataSource = { manager: plainManager };

  beforeEach(async () => {
    jest.resetAllMocks();
    plainManager.query.mockResolvedValue([]);
    transaction.query.mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [EnrollmentRosterService, { provide: DataSource, useValue: dataSource }],
    }).compile();

    service = moduleRef.get(EnrollmentRosterService);
  });

  describe("findRoster()", () => {
    it("answers [] without querying for a class id that is not a uuid", async () => {
      await expect(service.findRoster("not-a-uuid", "2026-03-10")).resolves.toEqual([]);

      expect(plainManager.query).not.toHaveBeenCalled();
    });

    it("throws for a date that is not a calendar date", async () => {
      await expect(service.findRoster(CLASS_ID, "2026-02-30")).rejects.toThrow("calendar date");
      await expect(service.findRoster(CLASS_ID, "10/03/2026")).rejects.toThrow("calendar date");

      expect(plainManager.query).not.toHaveBeenCalled();
    });

    it("passes the class, the day, the time zone and the included ids as parameters, and never locks (no FOR in the SQL)", async () => {
      const rows = [
        {
          id: SIGNED_ID,
          studentId: "01999a3e-7c1b-7000-8000-000000000001",
          status: "dropped",
          statusChangedAt: "2026-03-05",
        },
      ];
      transaction.query.mockResolvedValue(rows);

      const roster = await service.findRoster(
        CLASS_ID,
        "2026-03-10",
        { includeIds: [SIGNED_ID] },
        transaction as unknown as EntityManager,
      );

      expect(roster).toBe(rows);
      expect(plainManager.query).not.toHaveBeenCalled();
      const [sql, parameters] = transaction.query.mock.calls[0];
      expect(parameters).toEqual([CLASS_ID, "2026-03-10", "America/Sao_Paulo", [SIGNED_ID]]);
      // The rule of the day: not removed, enrolled on or before it, active or out only after it.
      expect(sql).toContain("e.deleted_at IS NULL");
      expect(sql).toContain("(e.enrolled_at AT TIME ZONE $3::text)::date <= $2::date");
      expect(sql).toContain("e.status = 'active' OR $2::date < e.status_changed_at");
      // A signed enrollment is in whatever happened to it.
      expect(sql).toContain("OR e.id = ANY($4::uuid[])");
      expect(sql).not.toMatch(/\bFOR\s+(UPDATE|SHARE|NO KEY|KEY)\b/i);
    });

    it("keeps only uuids of the included ids, lower case and deduped", async () => {
      await service.findRoster(CLASS_ID, "2026-03-10", {
        includeIds: [SIGNED_ID, SIGNED_ID.toUpperCase(), "not-a-uuid", OTHER_SIGNED_ID],
      });

      expect(plainManager.query.mock.calls[0][1][3]).toEqual([SIGNED_ID, OTHER_SIGNED_ID]);

      await service.findRoster(CLASS_ID, "2026-03-10");
      expect(plainManager.query.mock.calls[1][1][3]).toEqual([]);
    });

    it("reads status_changed_at as text", async () => {
      await service.findRoster(CLASS_ID, "2026-03-10");

      const [sql] = plainManager.query.mock.calls[0];
      expect(sql).toContain('e.status_changed_at::text AS "statusChangedAt"');
      expect(sql).toContain("ORDER BY e.student_id, e.id");
    });
  });

  describe("findRosterIds()", () => {
    it("answers [] without querying when no slot has a uuid class, and asks each class and day once", async () => {
      await expect(
        service.findRosterIds([
          { classId: "not-a-uuid", date: "2026-03-10" },
          { classId: CLASS_ID, date: "2026-02-30" },
        ]),
      ).resolves.toEqual([]);
      expect(plainManager.query).not.toHaveBeenCalled();

      const rows = [{ classId: CLASS_ID, date: "2026-03-10", enrollmentId: SIGNED_ID }];
      transaction.query.mockResolvedValue(rows);

      const found = await service.findRosterIds(
        [
          { classId: CLASS_ID, date: "2026-03-10" },
          { classId: CLASS_ID.toUpperCase(), date: "2026-03-10" },
          { classId: CLASS_ID, date: "2026-03-17" },
          { classId: OTHER_CLASS_ID, date: "2026-03-10" },
        ],
        transaction as unknown as EntityManager,
      );

      expect(found).toBe(rows);
      expect(transaction.query).toHaveBeenCalledTimes(1);
      const [sql, parameters] = transaction.query.mock.calls[0];
      expect(parameters).toEqual([
        [CLASS_ID, CLASS_ID, OTHER_CLASS_ID],
        ["2026-03-10", "2026-03-17", "2026-03-10"],
        "America/Sao_Paulo",
      ]);
      expect(sql).toContain("unnest($1::uuid[], $2::date[]) AS s(class_id, day)");
      expect(sql).toContain('s.day::text AS "date"');
      // The same rule as findRoster, on the day of each slot.
      expect(sql).toContain("e.deleted_at IS NULL");
      expect(sql).toContain("(e.enrolled_at AT TIME ZONE $3::text)::date <= s.day");
      expect(sql).toContain("e.status = 'active' OR s.day < e.status_changed_at");
      expect(sql).not.toMatch(/\bFOR\s+(UPDATE|SHARE|NO KEY|KEY)\b/i);
    });
  });
});
