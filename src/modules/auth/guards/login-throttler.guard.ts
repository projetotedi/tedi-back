import { HttpException, Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";

@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  /**
   * Custom tracker key: `<normalized-ra>:<ip>`.
   * Isolates rate-limiting per account+IP pair to avoid blocking
   * multiple users sharing the same IP (e.g. behind Vercel proxy — decision 25).
   */
  protected override async getTracker(req: Request): Promise<string> {
    const ra = String(req.body?.ra ?? "")
      .trim()
      .toLowerCase();
    const ip = req.ip ?? "unknown";
    return `${ra}:${ip}`;
  }

  /**
   * Throws a standardized 429 response with TOO_MANY_ATTEMPTS error code.
   */
  protected override async throwThrottlingException(): Promise<void> {
    throw new HttpException(
      {
        error: "TOO_MANY_ATTEMPTS",
        message: "Too many attempts. Try again in a few minutes.",
      },
      429,
    );
  }
}
