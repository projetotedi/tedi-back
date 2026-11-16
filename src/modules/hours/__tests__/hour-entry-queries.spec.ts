import "reflect-metadata";
import { SelectQueryBuilder } from "typeorm";
import { HourEntry } from "../entities/hour-entry.entity";
import { applyPopulation, EVERYONE, isNobody, populationOf } from "../services/hour-entry-queries";

const ANA = "01999a3e-0000-7000-8000-0000000000a1";

describe("hour entry queries", () => {
  const builder = { andWhere: jest.fn() };
  const query = builder as unknown as SelectQueryBuilder<HourEntry>;

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("tells nobody apart from everyone and from a list of people", () => {
    expect(isNobody(populationOf([]))).toBe(true);
    expect(isNobody(populationOf([ANA]))).toBe(false);
    expect(isNobody(EVERYONE)).toBe(false);
  });

  it("restricts to the people of the population, and adds nothing for everyone", () => {
    applyPopulation(query, EVERYONE);
    expect(builder.andWhere).not.toHaveBeenCalled();

    applyPopulation(query, populationOf([ANA]));
    expect(builder.andWhere).toHaveBeenCalledWith("entry.person_id IN (:...personIds)", {
      personIds: [ANA],
    });
  });

  it("throws for nobody instead of writing IN (), which is not SQL", () => {
    expect(() => applyPopulation(query, populationOf([]))).toThrow(
      "An hours query cannot be restricted to nobody: answer empty before querying.",
    );
    expect(builder.andWhere).not.toHaveBeenCalled();
  });
});
