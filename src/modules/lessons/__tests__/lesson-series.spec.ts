import { Weekday } from "../enums/weekday.enum";
import {
  addDays,
  buildSeries,
  firstOccurrenceOnOrAfter,
  SeriesPlan,
  weekdayOf,
  weeklyDates,
} from "../services/lesson-series";

const PERIOD = { startDate: "2026-03-03", endDate: "2026-06-27" };

const PLAN_IDS = [
  "01999a3e-7c1b-7000-8000-000000000011",
  "01999a3e-7c1b-7000-8000-000000000012",
  "01999a3e-7c1b-7000-8000-000000000013",
  "01999a3e-7c1b-7000-8000-000000000014",
];

/** The four plans of the course of the card, in the order of its sequence. */
function buildPlans(): SeriesPlan[] {
  const titles = [
    "Conhecendo o computador",
    "Teclado, mouse e janelas",
    "Navegando na internet",
    "Senhas e privacidade",
  ];

  return titles.map((title, index) => ({
    position: index + 1,
    lessonPlanId: PLAN_IDS[index],
    title,
    objective: index % 2 === 0 ? `Objetivo de ${title}.` : null,
    expectedDurationMinutes: 90,
  }));
}

describe("weekdayOf", () => {
  it.each([
    ["2026-04-06", Weekday.MONDAY],
    ["2026-04-07", Weekday.TUESDAY],
    ["2026-04-08", Weekday.WEDNESDAY],
    ["2026-04-09", Weekday.THURSDAY],
    ["2026-04-10", Weekday.FRIDAY],
    ["2026-04-11", Weekday.SATURDAY],
    ["2026-04-12", Weekday.SUNDAY],
  ])("%s is a %s", (date, weekday) => {
    expect(weekdayOf(date)).toBe(weekday);
  });

  it("knows the leap day and the turn of the year", () => {
    expect(weekdayOf("2028-02-29")).toBe(Weekday.TUESDAY);
    expect(weekdayOf("2026-12-31")).toBe(Weekday.THURSDAY);
    expect(weekdayOf("2027-01-01")).toBe(Weekday.FRIDAY);
  });
});

describe("addDays", () => {
  it("moves forward and backward by whole days", () => {
    expect(addDays("2026-04-07", 0)).toBe("2026-04-07");
    expect(addDays("2026-04-07", 1)).toBe("2026-04-08");
    expect(addDays("2026-04-07", 7)).toBe("2026-04-14");
    expect(addDays("2026-04-07", -7)).toBe("2026-03-31");
  });

  it("crosses the end of a month and of a year, zero-padded", () => {
    expect(addDays("2026-04-28", 7)).toBe("2026-05-05");
    expect(addDays("2026-12-29", 7)).toBe("2027-01-05");
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
  });

  it("knows the leap day and the years that are not leap", () => {
    expect(addDays("2028-02-22", 7)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 7)).toBe("2028-03-07");
    expect(addDays("2026-02-22", 7)).toBe("2026-03-01");
  });

  it("does not drift across the days daylight saving changes in other countries", () => {
    // 23 and 25 hour days of a local calendar: here every day is a day.
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-10-31", 2)).toBe("2026-11-02");
  });
});

describe("firstOccurrenceOnOrAfter", () => {
  it("keeps the date when it already is the weekday", () => {
    expect(firstOccurrenceOnOrAfter("2026-04-07", Weekday.TUESDAY)).toBe("2026-04-07");
  });

  it("advances to the next weekday when the date is not one", () => {
    expect(firstOccurrenceOnOrAfter("2026-04-06", Weekday.TUESDAY)).toBe("2026-04-07");
    expect(firstOccurrenceOnOrAfter("2026-04-08", Weekday.TUESDAY)).toBe("2026-04-14");
  });

  it("never goes back and goes at most six days ahead", () => {
    for (const weekday of Object.values(Weekday)) {
      // 2026-04-06 to 2026-04-12 is one whole week, a monday to a sunday.
      for (let offset = 0; offset < 7; offset += 1) {
        const date = addDays("2026-04-06", offset);
        const found = firstOccurrenceOnOrAfter(date, weekday);

        expect(weekdayOf(found)).toBe(weekday);
        expect(found >= date).toBe(true);
        expect(found <= addDays(date, 6)).toBe(true);
      }
    }
  });

  it("crosses a month, a year and the leap day", () => {
    expect(firstOccurrenceOnOrAfter("2026-12-30", Weekday.TUESDAY)).toBe("2027-01-05");
    expect(firstOccurrenceOnOrAfter("2028-02-23", Weekday.TUESDAY)).toBe("2028-02-29");
    expect(firstOccurrenceOnOrAfter("2026-04-29", Weekday.THURSDAY)).toBe("2026-04-30");
    expect(firstOccurrenceOnOrAfter("2026-04-30", Weekday.MONDAY)).toBe("2026-05-04");
  });
});

describe("weeklyDates", () => {
  it("returns weekly dates from the first date", () => {
    expect(weeklyDates("2026-04-07", Weekday.TUESDAY, 4)).toEqual([
      "2026-04-07",
      "2026-04-14",
      "2026-04-21",
      "2026-04-28",
    ]);
  });

  it("advances firstDate to the next weekday when it is not one", () => {
    // 2026-04-06 is a monday: the series of a tuesday starts the day after.
    expect(weeklyDates("2026-04-06", Weekday.TUESDAY, 2)).toEqual(["2026-04-07", "2026-04-14"]);
    // A wednesday has already gone by: the next tuesday is a week away.
    expect(weeklyDates("2026-04-08", Weekday.TUESDAY, 2)).toEqual(["2026-04-14", "2026-04-21"]);
  });

  it("keeps firstDate when it already is the weekday", () => {
    expect(weeklyDates("2026-04-07", Weekday.TUESDAY, 1)).toEqual(["2026-04-07"]);
    expect(weeklyDates("2026-04-12", Weekday.SUNDAY, 2)).toEqual(["2026-04-12", "2026-04-19"]);
  });

  it("crosses month and year", () => {
    expect(weeklyDates("2026-12-29", Weekday.TUESDAY, 3)).toEqual([
      "2026-12-29",
      "2027-01-05",
      "2027-01-12",
    ]);
    expect(weeklyDates("2026-04-28", Weekday.TUESDAY, 2)).toEqual(["2026-04-28", "2026-05-05"]);
  });

  it("handles leap day", () => {
    expect(weeklyDates("2028-02-22", Weekday.TUESDAY, 3)).toEqual([
      "2028-02-22",
      "2028-02-29",
      "2028-03-07",
    ]);
    // In a year that is not leap there is no 29th: February goes straight to March.
    expect(weeklyDates("2026-02-24", Weekday.TUESDAY, 2)).toEqual(["2026-02-24", "2026-03-03"]);
  });

  it("returns [] for count 0", () => {
    expect(weeklyDates("2026-04-07", Weekday.TUESDAY, 0)).toEqual([]);
  });

  it("returns [] for a negative count instead of failing", () => {
    expect(weeklyDates("2026-04-07", Weekday.TUESDAY, -1)).toEqual([]);
  });

  it("returns every date on the weekday asked for, seven days apart", () => {
    for (const weekday of Object.values(Weekday)) {
      const dates = weeklyDates("2026-03-03", weekday, 20);

      expect(dates).toHaveLength(20);
      expect(dates.every((date) => weekdayOf(date) === weekday)).toBe(true);
      dates.slice(1).forEach((date, index) => expect(date).toBe(addDays(dates[index], 7)));
    }
  });
});

describe("buildSeries", () => {
  it("gives each plan, in the order it came, the weekly date of its place", () => {
    const series = buildSeries(buildPlans(), "2026-04-07", Weekday.TUESDAY, PERIOD);

    expect(series.map((item) => [item.position, item.title, item.date])).toEqual([
      [1, "Conhecendo o computador", "2026-04-07"],
      [2, "Teclado, mouse e janelas", "2026-04-14"],
      [3, "Navegando na internet", "2026-04-21"],
      [4, "Senhas e privacidade", "2026-04-28"],
    ]);
    expect(series.every((item) => item.outsideClassPeriod === false)).toBe(true);
  });

  it("carries everything the plan had: the lesson copies the title and the objective from it", () => {
    const plans = buildPlans();

    const series = buildSeries(plans, "2026-04-07", Weekday.TUESDAY, PERIOD);

    expect(series[0]).toEqual({
      position: 1,
      lessonPlanId: PLAN_IDS[0],
      title: "Conhecendo o computador",
      objective: "Objetivo de Conhecendo o computador.",
      expectedDurationMinutes: 90,
      date: "2026-04-07",
      outsideClassPeriod: false,
    });
    expect(series[1].objective).toBeNull();
    // The plans it received are not changed.
    expect(plans[0]).not.toHaveProperty("date");
  });

  it("flags dates after endDate and before startDate as outsideClassPeriod, ends included", () => {
    const shortClass = { startDate: "2026-04-14", endDate: "2026-04-21" };

    const series = buildSeries(buildPlans(), "2026-04-07", Weekday.TUESDAY, shortClass);

    // The first and the last day of the class are inside: both ends take a lesson.
    expect(series.map((item) => [item.date, item.outsideClassPeriod])).toEqual([
      ["2026-04-07", true],
      ["2026-04-14", false],
      ["2026-04-21", false],
      ["2026-04-28", true],
    ]);
  });

  it("flags only the fourth lesson when the class ends on 2026-04-24", () => {
    const series = buildSeries(buildPlans(), "2026-04-07", Weekday.TUESDAY, {
      startDate: "2026-03-03",
      endDate: "2026-04-24",
    });

    expect(series.map((item) => item.outsideClassPeriod)).toEqual([false, false, false, true]);
  });

  it("flags every lesson of a class that is over before the series starts", () => {
    const series = buildSeries(buildPlans(), "2026-07-07", Weekday.TUESDAY, PERIOD);

    expect(series.every((item) => item.outsideClassPeriod)).toBe(true);
  });

  it("uses the day of the week, not firstDate, for the first lesson", () => {
    const series = buildSeries(buildPlans(), "2026-04-06", Weekday.TUESDAY, PERIOD);

    expect(series[0].date).toBe("2026-04-07");
  });

  it("leaves no gap in the days for a plan the caller left out, and keeps the positions it was given", () => {
    // The second plan of the sequence is archived: the caller does not pass it.
    const [first, , third, fourth] = buildPlans();

    const series = buildSeries([first, third, fourth], "2026-04-07", Weekday.TUESDAY, PERIOD);

    expect(series.map((item) => [item.position, item.date])).toEqual([
      [1, "2026-04-07"],
      [3, "2026-04-14"],
      [4, "2026-04-21"],
    ]);
  });

  it("returns [] for no plans", () => {
    expect(buildSeries([], "2026-04-07", Weekday.TUESDAY, PERIOD)).toEqual([]);
  });
});
