import { Injectable } from "@nestjs/common";

/** Injectable source of "now", so services are testable with a fixed instant. */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}
