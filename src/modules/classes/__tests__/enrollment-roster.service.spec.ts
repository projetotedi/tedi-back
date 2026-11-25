import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { DataSource, EntityManager } from "typeorm";
import { EnrollmentRosterService, RosterSlot } from "../services/enrollment-roster.service";

const CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c1";
const OTHER_CLASS_ID = "01999a3e-7c1b-7000-8000-0000000000c2";
const SIGNED_ID = "01999a3e-7c1b-7000-8000-0000000000f1";
const OTHER_SIGNED_ID = "01999a3e-7c1b-7000-8000-0000000000f2";

/** The lesson of 2026-03-10 that ends at 11:00, unless `overrides` says otherwise. */
function slotOf(overrides: Partial<RosterSlot> = {}): RosterSlot {
  return { classId: CLASS_ID, date: "2026-03-10", endTime: "11:00", ...overrides };
}

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
    it("throws for a class id that is not a uuid, without querying", async () => {
      await expect(service.findRoster(slotOf({ classId: "not-a-uuid" }))).rejects.toThrow(
        'The class of a roll call must be a uuid, got "not-a-uuid".',
      );

      expect(plainManager.query).not.toHaveBeenCalled();
    });

    it("throws for a date that is not a calendar date or an end that is not a time of day", async () => {
      await expect(service.findRoster(slotOf({ date: "2026-02-30" }))).rejects.toThrow(
        "calendar date",
      );
      await expect(service.findRoster(slotOf({ date: "10/03/2026" }))).rejects.toThrow(
        "calendar date",
      );
      await expect(service.findRoster(slotOf({ endTime: "24:00" }))).rejects.toThrow("end time");
      await expect(service.findRoster(slotOf({ endTime: "11h" }))).rejects.toThrow("end time");

      expect(plainManager.query).not.toHaveBeenCalled();
    });

    it("passes the class, the day, the end, the time zone and the included ids as parameters, and never locks (no FOR in the SQL)", async () => {
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
        slotOf(),
        { includeIds: [SIGNED_ID] },
        transaction as unknown as EntityManager,
      );

      expect(roster).toBe(rows);
      expect(plainManager.query).not.toHaveBeenCalled();
      const [sql, parameters] = transaction.query.mock.calls[0];
      expect(parameters).toEqual([
        CLASS_ID,
        "2026-03-10",
        "11:00",
        "America/Sao_Paulo",
        [SIGNED_ID],
      ]);
      // The rule of the lesson: not removed, enrolled before it ended, in force on its day.
      expect(sql).toContain("e.deleted_at IS NULL");
      expect(sql).toContain("e.enrolled_at < (($2::date + $3::time) AT TIME ZONE $4::text)");
      expect(sql).toContain("(e.status = 'active' AND $2::date >= e.status_changed_at)");
      expect(sql).toContain("(e.status <> 'active' AND $2::date < e.status_changed_at)");
      // A signed enrollment is in whatever happened to it.
      expect(sql).toContain("OR e.id = ANY($5::uuid[])");
      expect(sql).not.toMatch(/\bFOR\s+(UPDATE|SHARE|NO KEY|KEY)\b/i);
    });

    it("a reactivated enrollment is not expected in the lessons before its reactivation", async () => {
      await service.findRoster(slotOf());

      const [sql] = plainManager.query.mock.calls[0];
      // An active enrollment counts from statusChangedAt on, the day its current status holds from:
      // reactivated "from 2026-04-01", it is out of the lesson of 2026-03-10 (unless signed in it).
      expect(sql).toContain("(e.status = 'active' AND $2::date >= e.status_changed_at)");
      expect(sql).not.toMatch(/e\.status = 'active' OR/);
    });

    it("compares the instant of the enrollment with the end of the lesson, in America/Sao_Paulo", async () => {
      await service.findRoster(slotOf({ endTime: "15:30" }));

      const [sql, parameters] = plainManager.query.mock.calls[0];
      // Made at 16:00 of the day of the lesson, after it ended at 15:30: not expected at it.
      expect(sql).toContain("e.enrolled_at < (($2::date + $3::time) AT TIME ZONE $4::text)");
      expect(sql).not.toContain("::date <= $2::date");
      expect(parameters.slice(1, 4)).toEqual(["2026-03-10", "15:30", "America/Sao_Paulo"]);
    });

    it("keeps only uuids of the included ids, lower case and deduped", async () => {
      await service.findRoster(slotOf(), {
        includeIds: [SIGNED_ID, SIGNED_ID.toUpperCase(), "not-a-uuid", OTHER_SIGNED_ID],
      });

      expect(plainManager.query.mock.calls[0][1][4]).toEqual([SIGNED_ID, OTHER_SIGNED_ID]);

      await service.findRoster(slotOf());
      expect(plainManager.query.mock.calls[1][1][4]).toEqual([]);
    });

    it("reads status_changed_at as text", async () => {
      await service.findRoster(slotOf());

      const [sql] = plainManager.query.mock.calls[0];
      expect(sql).toContain('e.status_changed_at::text AS "statusChangedAt"');
      expect(sql).toContain("ORDER BY e.student_id, e.id");
    });
  });

  describe("findRosterIds()", () => {
    it("answers [] without querying when no slot has a uuid class, and asks each class, day and end once", async () => {
      await expect(
        service.findRosterIds([
          slotOf({ classId: "not-a-uuid" }),
          slotOf({ date: "2026-02-30" }),
          slotOf({ endTime: "25:00" }),
        ]),
      ).resolves.toEqual([]);
      expect(plainManager.query).not.toHaveBeenCalled();

      const rows = [
        { classId: CLASS_ID, date: "2026-03-10", endTime: "11:00", enrollmentId: SIGNED_ID },
      ];
      transaction.query.mockResolvedValue(rows);

      const found = await service.findRosterIds(
        [
          slotOf(),
          slotOf({ classId: CLASS_ID.toUpperCase() }),
          slotOf({ date: "2026-03-17" }),
          slotOf({ classId: OTHER_CLASS_ID }),
          slotOf({ endTime: "15:30" }),
        ],
        transaction as unknown as EntityManager,
      );

      expect(found).toBe(rows);
      expect(transaction.query).toHaveBeenCalledTimes(1);
      const [sql, parameters] = transaction.query.mock.calls[0];
      expect(parameters).toEqual([
        [CLASS_ID, CLASS_ID, OTHER_CLASS_ID, CLASS_ID],
        ["2026-03-10", "2026-03-17", "2026-03-10", "2026-03-10"],
        ["11:00", "11:00", "11:00", "15:30"],
        "America/Sao_Paulo",
      ]);
      expect(sql).toContain(
        "unnest($1::uuid[], $2::date[], $3::time[]) AS s(class_id, day, end_time)",
      );
      expect(sql).toContain('s.day::text AS "date"');
      expect(sql).toContain(`to_char(s.end_time, 'HH24:MI') AS "endTime"`);
      // The same rule as findRoster, on the day and the end of each slot.
      expect(sql).toContain("e.deleted_at IS NULL");
      expect(sql).toContain("e.enrolled_at < ((s.day + s.end_time) AT TIME ZONE $4::text)");
      expect(sql).toContain("(e.status = 'active' AND s.day >= e.status_changed_at)");
      expect(sql).toContain("(e.status <> 'active' AND s.day < e.status_changed_at)");
      expect(sql).not.toMatch(/\bFOR\s+(UPDATE|SHARE|NO KEY|KEY)\b/i);

      // Without a manager, a plain read.
      await service.findRosterIds([slotOf()]);
      expect(plainManager.query).toHaveBeenCalledTimes(1);
    });
  });
});
