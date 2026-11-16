import "reflect-metadata";
import { HourEntry } from "../entities/hour-entry.entity";
import { HourEntryCategory } from "../enums/hour-entry-category.enum";
import { HourEntryOrigin } from "../enums/hour-entry-origin.enum";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";
import {
  CSV_BOM,
  csvCell,
  csvLine,
  HOURS_CSV_HEADER,
  hoursExportFileName,
  toHoursCsvValues,
} from "../services/hours-csv";

const ENTRY_ID = "01999a3e-7c1b-7000-8000-000000000a01";
const PERSON_ID = "01999a3e-0000-7000-8000-0000000000a1";
const REVIEWED_AT = new Date("2026-03-12T13:00:00.000Z");

const ENTRY = Object.assign(new HourEntry(), {
  id: ENTRY_ID,
  personId: PERSON_ID,
  createdById: PERSON_ID,
  origin: HourEntryOrigin.MANUAL,
  activity: "Reunião de planejamento",
  category: HourEntryCategory.MEETING,
  date: "2026-03-11",
  declaredMinutes: 240,
  validatedMinutes: 120,
  notes: "Nota pessoal que não sai.",
  status: HourEntryStatus.ADJUSTED,
  classId: null,
  lessonId: null,
  reviewNote: "Duas horas.",
  reviewedById: PERSON_ID,
  reviewedAt: REVIEWED_AT,
  createdAt: REVIEWED_AT,
  updatedAt: REVIEWED_AT,
  deletedAt: null,
});

describe("hours csv", () => {
  it("quotes every cell and doubles the quotes inside it", () => {
    expect(csvCell("Planejamento")).toBe('"Planejamento"');
    expect(csvCell('Aula "extra" de teclado')).toBe('"Aula ""extra"" de teclado"');
    expect(csvCell("")).toBe('""');
  });

  it.each(["=", "+", "-", "@", "\t", "\r"])(
    "prefixes a cell that starts with %j with an apostrophe, against formula injection",
    (start) => {
      expect(csvCell(`${start}SUM(A1:A9)`)).toBe(`"'${start}SUM(A1:A9)"`);
    },
  );

  it("keeps a formula character that is not the first one as it is", () => {
    expect(csvCell("Reunião = 2h")).toBe('"Reunião = 2h"');
  });

  it("keeps semicolons and line breaks inside the quoted cell, and ends every line with CRLF", () => {
    expect(csvCell("Pauta; calendário\nturmas")).toBe('"Pauta; calendário\nturmas"');
    expect(csvLine(["a;b", "c"])).toBe('"a;b";"c"\r\n');
  });

  it("writes null as an empty cell and numbers as they are", () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(150)).toBe('"150"');
    expect(csvCell(0)).toBe('"0"');
    expect(csvLine([null, 90, "x"])).toBe('"";"90";"x"\r\n');
  });

  it("maps an entry and its member to the columns of the header, in order, with the date as YYYY-MM-DD and reviewed_at in ISO 8601", () => {
    const values = toHoursCsvValues(ENTRY, {
      id: PERSON_ID,
      name: "Ana Souza",
      department: { id: "01999a3e-1111-7000-8000-000000000001", name: "Tecnologia" },
    });

    expect(HOURS_CSV_HEADER).toEqual([
      "entry_id",
      "date",
      "person_id",
      "member_name",
      "department",
      "category",
      "activity",
      "origin",
      "status",
      "declared_minutes",
      "validated_minutes",
      "review_note",
      "reviewed_at",
    ]);
    expect(values).toEqual([
      ENTRY_ID,
      "2026-03-11",
      PERSON_ID,
      "Ana Souza",
      "Tecnologia",
      "meeting",
      "Reunião de planejamento",
      "manual",
      "adjusted",
      240,
      120,
      "Duas horas.",
      "2026-03-12T13:00:00.000Z",
    ]);
    expect(values).toHaveLength(HOURS_CSV_HEADER.length);
    expect(values).not.toContain("Nota pessoal que não sai.");
  });

  it("leaves name and department empty when the member is not found or has no department, and nulls of a pending entry empty", () => {
    const pending = Object.assign(new HourEntry(), {
      ...ENTRY,
      status: HourEntryStatus.PENDING,
      validatedMinutes: null,
      reviewNote: null,
      reviewedAt: null,
    });

    expect(toHoursCsvValues(pending, null)).toEqual([
      ENTRY_ID,
      "2026-03-11",
      PERSON_ID,
      null,
      null,
      "meeting",
      "Reunião de planejamento",
      "manual",
      "pending",
      240,
      null,
      null,
      null,
    ]);
    expect(
      toHoursCsvValues(pending, { id: PERSON_ID, name: "Carla", department: null }).slice(3, 5),
    ).toEqual(["Carla", null]);
  });

  it("names the file hours_<from>_<to>.csv, with start and end for open ends", () => {
    expect(hoursExportFileName({ from: "2026-03-01", to: "2026-03-31" })).toBe(
      "hours_2026-03-01_2026-03-31.csv",
    );
    expect(hoursExportFileName({ from: "2026-03-01" })).toBe("hours_2026-03-01_end.csv");
    expect(hoursExportFileName({ to: "2026-03-31" })).toBe("hours_start_2026-03-31.csv");
    expect(hoursExportFileName({})).toBe("hours_start_end.csv");
  });

  it("starts the file with the byte order mark, the bytes EF BB BF in UTF-8", () => {
    expect([...Buffer.from(CSV_BOM, "utf8")]).toEqual([0xef, 0xbb, 0xbf]);
    expect(CSV_BOM).toBe("\uFEFF");
  });
});
