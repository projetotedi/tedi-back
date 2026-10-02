import "reflect-metadata";
import { validate } from "class-validator";
import { todayInAppTimeZone } from "@shared/dates/calendar-date";
import { BRAZILIAN_STATES, normalizeState } from "../validators/brazilian-state";
import { IsCpf, isValidCpf, normalizeCpf } from "../validators/cpf";
import { IsJoinedAt, MIN_JOINED_AT } from "../validators/is-joined-at.validator";

describe("isValidCpf", () => {
  it("accepts 52998224725 and 11144477735", () => {
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidCpf("11144477735")).toBe(true);
  });

  it("rejects a wrong check digit such as 52998224724", () => {
    expect(isValidCpf("52998224724")).toBe(false);
    expect(isValidCpf("52998224715")).toBe(false);
    expect(isValidCpf("11144477736")).toBe(false);
  });

  it("rejects repeated digits such as 11111111111", () => {
    for (let digit = 0; digit <= 9; digit++) {
      expect(isValidCpf(String(digit).repeat(11))).toBe(false);
    }
  });

  it("rejects fewer or more than 11 digits and letters", () => {
    expect(isValidCpf("")).toBe(false);
    expect(isValidCpf("5299822472")).toBe(false);
    expect(isValidCpf("529982247255")).toBe(false);
    expect(isValidCpf("5299822472a")).toBe(false);
    // Formatting is stripped by normalizeCpf before the validator runs.
    expect(isValidCpf("529.982.247-25")).toBe(false);
  });
});

describe("normalizeCpf", () => {
  it("strips dots, dash and spaces and turns a blank value into null", () => {
    expect(normalizeCpf({ value: "529.982.247-25" })).toBe("52998224725");
    expect(normalizeCpf({ value: " 529 982 247 25 " })).toBe("52998224725");
    expect(normalizeCpf({ value: "   " })).toBeNull();
    expect(normalizeCpf({ value: "" })).toBeNull();
    // Letters stay so IsCpf can reject them.
    expect(normalizeCpf({ value: "5299822472a" })).toBe("5299822472a");
    // Other types pass through for the validator to reject.
    expect(normalizeCpf({ value: 52998224725 })).toBe(52998224725);
  });
});

describe("BRAZILIAN_STATES", () => {
  it("lists the 27 federative units", () => {
    expect(BRAZILIAN_STATES).toHaveLength(27);
    expect(new Set(BRAZILIAN_STATES).size).toBe(27);
    expect(BRAZILIAN_STATES).toEqual(expect.arrayContaining(["SP", "PR", "DF", "TO", "AC"]));
  });
});

describe("normalizeState", () => {
  it("trims and upper-cases; a blank value becomes null", () => {
    expect(normalizeState({ value: " sp " })).toBe("SP");
    expect(normalizeState({ value: "pr" })).toBe("PR");
    expect(normalizeState({ value: "  " })).toBeNull();
    expect(normalizeState({ value: "" })).toBeNull();
    expect(normalizeState({ value: 12 })).toBe(12);
  });
});

describe("decorators", () => {
  class Sample {
    @IsCpf()
    cpf!: unknown;

    @IsJoinedAt()
    joinedAt!: unknown;
  }

  async function messagesOf(values: { cpf: unknown; joinedAt: unknown }): Promise<string[]> {
    const sample = Object.assign(new Sample(), values);
    const errors = await validate(sample);
    return errors.flatMap((error) => Object.values(error.constraints ?? {}));
  }

  it("IsCpf reports a message that does not echo the value", async () => {
    const messages = await messagesOf({ cpf: "52998224724", joinedAt: "2026-01-01" });

    expect(messages).toEqual(["cpf must be a valid CPF"]);
    expect(messages.join()).not.toContain("52998224724");
  });

  it("IsCpf rejects values that are not strings", async () => {
    expect(await messagesOf({ cpf: 52998224725, joinedAt: "2026-01-01" })).toHaveLength(1);
    expect(await messagesOf({ cpf: null, joinedAt: "2026-01-01" })).toHaveLength(1);
  });

  it("IsJoinedAt accepts the floor, today and a regular date", async () => {
    for (const joinedAt of [MIN_JOINED_AT, todayInAppTimeZone(), "2026-10-01"]) {
      expect(await messagesOf({ cpf: "52998224725", joinedAt })).toEqual([]);
    }
  });

  it("IsJoinedAt rejects before 2000-01-01, the future, impossible dates and other formats", async () => {
    const tomorrow = new Date(Date.parse(`${todayInAppTimeZone()}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);

    for (const joinedAt of [
      "1999-12-31",
      tomorrow,
      "2023-02-30",
      "01/10/2026",
      "2026-10-01T00:00:00Z",
      "",
      20261001,
      null,
    ]) {
      expect(await messagesOf({ cpf: "52998224725", joinedAt })).toEqual([
        "joinedAt must be a date in YYYY-MM-DD format between 2000-01-01 and today",
      ]);
    }
  });
});
