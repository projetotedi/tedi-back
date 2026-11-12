import "reflect-metadata";
import { validate } from "class-validator";
import { IsTimeOfDay } from "../is-time-of-day.validator";

class Probe {
  @IsTimeOfDay()
  time!: unknown;
}

class ProbeWithMessage {
  @IsTimeOfDay({ message: "custom message" })
  time!: unknown;
}

async function errorsOf(time: unknown, target: new () => object = Probe) {
  return validate(Object.assign(new target(), { time }));
}

describe("IsTimeOfDay", () => {
  it("accepts 00:00 and 23:59 and the times in between", async () => {
    for (const time of ["00:00", "00:01", "09:00", "14:00", "15:30", "23:59"]) {
      expect(await errorsOf(time)).toHaveLength(0);
    }
  });

  it("rejects an hour or a minute that does not exist", async () => {
    for (const time of ["24:00", "24:01", "25:30", "12:60", "99:99"]) {
      expect(await errorsOf(time)).toHaveLength(1);
    }
  });

  it("rejects 9:00 and 14:00:00: the shape is exactly HH:mm", async () => {
    for (const time of [
      "9:00",
      "09:0",
      "14:00:00",
      "14:00:00.000",
      "14h00",
      " 14:00",
      "14:00\n",
      "",
    ]) {
      expect(await errorsOf(time)).toHaveLength(1);
    }
  });

  it("rejects a value that is not a string, null and a missing one", async () => {
    for (const time of [1400, 14, 0, null, undefined, true, {}, [], ["14:00"], new Date()]) {
      expect(await errorsOf(time)).toHaveLength(1);
    }
  });

  it("explains the error by the field and the format", async () => {
    const [error] = await errorsOf("24:00");

    expect(error.property).toBe("time");
    expect(error.constraints).toEqual({ isTimeOfDay: "time must be a time in HH:mm format" });
  });

  it("uses the message it is given", async () => {
    const [error] = await errorsOf("nope", ProbeWithMessage);

    expect(error.constraints).toEqual({ isTimeOfDay: "custom message" });
  });
});
