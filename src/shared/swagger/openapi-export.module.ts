/**
 * Minimal NestJS module used exclusively by `scripts/openapi-runtime.ts` to
 * generate `docs/openapi.json` **without** connecting to the database or
 * starting an HTTP server.
 *
 * Rules for maintaining this file:
 * - NEVER import TypeOrmModule, AuthModule, ConfigModule, or any module that
 *   requires env variables or a database connection.
 * - When a new controller is added to the project, register it here so its
 *   routes appear in the exported contract.
 * - Provide a DataSource stub so controllers that inject DataSource
 *   (e.g. HealthController) can be instantiated without a real connection.
 */
import { Module } from "@nestjs/common";
import { DataSource } from "typeorm";
import { JwtService } from "@nestjs/jwt";
import { ThrottlerStorage } from "@nestjs/throttler";
import { HealthController } from "@shared/health/health.controller";
import { AuthController } from "@modules/auth/auth.controller";
import { AuthService } from "@modules/auth/services/auth.service";
import { LoginThrottlerGuard } from "@modules/auth/guards/login-throttler.guard";

const THROTTLER_OPTIONS_TOKEN = "THROTTLER:MODULE_OPTIONS";

@Module({
  controllers: [HealthController, AuthController],
  providers: [
    {
      provide: DataSource,
      useValue: { query: async () => [] },
    },
    {
      provide: AuthService,
      useValue: { login: async () => ({}), getMe: async () => ({}) },
    },
    {
      provide: JwtService,
      useValue: { signAsync: async () => "" },
    },
    {
      provide: THROTTLER_OPTIONS_TOKEN,
      useValue: [{ ttl: 900000, limit: 10 }],
    },
    {
      provide: ThrottlerStorage,
      useValue: {
        increment: async () => ({
          totalHits: 0,
          timeToExpire: 0,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
      },
    },
    LoginThrottlerGuard,
  ],
})
export class OpenApiExportModule {}
