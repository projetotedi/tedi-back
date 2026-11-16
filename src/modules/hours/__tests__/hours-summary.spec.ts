import { HourEntryCategory } from "../enums/hour-entry-category.enum";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";
import { buildHoursSummary, HoursSummaryRow } from "../services/hours-summary";

const OPEN_PERIOD = { from: null, to: null };

function row(overrides: Partial<HoursSummaryRow>): HoursSummaryRow {
  return {
    status: HourEntryStatus.PENDING,
    category: HourEntryCategory.PLANNING,
    entries: 1,
    declaredMinutes: 150,
    validatedMinutes: 0,
    ...overrides,
  };
}

describe("buildHoursSummary", () => {
  it("returns every status and every category in enum order, with zeros, when there are no rows", () => {
    const summary = buildHoursSummary([], OPEN_PERIOD);

    expect(summary.bankMinutes).toBe(0);
    expect(summary.byStatus).toEqual(
      Object.values(HourEntryStatus).map((status) => ({
        status,
        entries: 0,
        declaredMinutes: 0,
        validatedMinutes: 0,
      })),
    );
    expect(summary.byCategory).toEqual(
      Object.values(HourEntryCategory).map((category) => ({
        category,
        entries: 0,
        declaredMinutes: 0,
        bankMinutes: 0,
        pendingMinutes: 0,
      })),
    );
  });

  it("sums entries, declared and validated minutes per status", () => {
    const summary = buildHoursSummary(
      [
        row({
          status: HourEntryStatus.PENDING,
          category: HourEntryCategory.PLANNING,
          entries: 2,
          declaredMinutes: 270,
        }),
        row({
          status: HourEntryStatus.PENDING,
          category: HourEntryCategory.MEETING,
          entries: 1,
          declaredMinutes: 60,
        }),
        row({
          status: HourEntryStatus.REJECTED,
          category: HourEntryCategory.EVENT,
          entries: 1,
          declaredMinutes: 90,
          validatedMinutes: 0,
        }),
        row({
          status: HourEntryStatus.ADJUSTED,
          category: HourEntryCategory.PLANNING,
          entries: 1,
          declaredMinutes: 150,
          validatedMinutes: 120,
        }),
      ],
      OPEN_PERIOD,
    );

    expect(summary.byStatus).toEqual([
      { status: HourEntryStatus.PENDING, entries: 3, declaredMinutes: 330, validatedMinutes: 0 },
      { status: HourEntryStatus.APPROVED, entries: 0, declaredMinutes: 0, validatedMinutes: 0 },
      { status: HourEntryStatus.ADJUSTED, entries: 1, declaredMinutes: 150, validatedMinutes: 120 },
      { status: HourEntryStatus.REJECTED, entries: 1, declaredMinutes: 90, validatedMinutes: 0 },
    ]);
  });

  it("counts in the bank only the validated minutes of approved and adjusted entries, per category and in total", () => {
    const summary = buildHoursSummary(
      [
        row({
          status: HourEntryStatus.APPROVED,
          category: HourEntryCategory.PLANNING,
          declaredMinutes: 60,
          validatedMinutes: 60,
        }),
        row({
          status: HourEntryStatus.ADJUSTED,
          category: HourEntryCategory.PLANNING,
          declaredMinutes: 150,
          validatedMinutes: 120,
        }),
        row({
          status: HourEntryStatus.ADJUSTED,
          category: HourEntryCategory.MEETING,
          declaredMinutes: 90,
          validatedMinutes: 45,
        }),
        row({
          status: HourEntryStatus.REJECTED,
          category: HourEntryCategory.PLANNING,
          declaredMinutes: 300,
          validatedMinutes: 30,
        }),
        row({
          status: HourEntryStatus.PENDING,
          category: HourEntryCategory.PLANNING,
          declaredMinutes: 200,
        }),
      ],
      OPEN_PERIOD,
    );

    expect(summary.bankMinutes).toBe(225);
    const planning = summary.byCategory.find(
      (total) => total.category === HourEntryCategory.PLANNING,
    );
    expect(planning).toEqual({
      category: HourEntryCategory.PLANNING,
      entries: 4,
      declaredMinutes: 710,
      bankMinutes: 180,
      pendingMinutes: 200,
    });
    expect(
      summary.byCategory.find((total) => total.category === HourEntryCategory.MEETING)?.bankMinutes,
    ).toBe(45);
  });

  it("counts as pending, per category, the declared minutes of pending entries", () => {
    const summary = buildHoursSummary(
      [
        row({
          status: HourEntryStatus.PENDING,
          category: HourEntryCategory.SUPPORT,
          entries: 2,
          declaredMinutes: 75,
        }),
        row({
          status: HourEntryStatus.APPROVED,
          category: HourEntryCategory.SUPPORT,
          declaredMinutes: 30,
          validatedMinutes: 30,
        }),
      ],
      OPEN_PERIOD,
    );

    expect(
      summary.byCategory.find((total) => total.category === HourEntryCategory.SUPPORT),
    ).toEqual({
      category: HourEntryCategory.SUPPORT,
      entries: 3,
      declaredMinutes: 105,
      bankMinutes: 30,
      pendingMinutes: 75,
    });
  });

  it("echoes the period, null when open", () => {
    expect(buildHoursSummary([], { from: "2026-03-01", to: "2026-03-31" })).toMatchObject({
      from: "2026-03-01",
      to: "2026-03-31",
    });
    expect(buildHoursSummary([], { from: "2026-03-01", to: null })).toMatchObject({
      from: "2026-03-01",
      to: null,
    });
    expect(buildHoursSummary([], OPEN_PERIOD)).toMatchObject({ from: null, to: null });
  });

  it("throws on a status or category it does not know instead of publishing a wrong total", () => {
    expect(() => buildHoursSummary([row({ status: "open" })], OPEN_PERIOD)).toThrow(
      "unknown status or category: open, planning",
    );
    expect(() => buildHoursSummary([row({ category: "class" })], OPEN_PERIOD)).toThrow(
      "unknown status or category: pending, class",
    );
  });

  it("throws on a total that is not a whole number instead of concatenating it", () => {
    const unsafe: Array<Record<string, unknown>> = [
      { entries: "1" },
      { declaredMinutes: "150" },
      { validatedMinutes: "120" },
      { declaredMinutes: 1.5 },
    ];

    for (const overrides of unsafe) {
      const bad = { ...row({}), ...overrides };
      expect(() => buildHoursSummary([bad as unknown as HoursSummaryRow], OPEN_PERIOD)).toThrow(
        "not a whole number",
      );
    }
  });
});
