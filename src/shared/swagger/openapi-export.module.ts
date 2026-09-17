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
import { HealthController } from "@shared/health/health.controller";

@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: DataSource,
      useValue: { query: async () => [] },
    },
  ],
})
export class OpenApiExportModule {}
