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
import { ConfigService } from "@nestjs/config";
import { ThrottlerStorage } from "@nestjs/throttler";
import { HealthController } from "@shared/health/health.controller";
import { AuthController } from "@modules/auth/auth.controller";
import { InvitesController } from "@modules/auth/invites.controller";
import { AccessController } from "@modules/auth/access.controller";
import { DepartmentsController } from "@modules/people/controllers/departments.controller";
import { MemberRegistrationsController } from "@modules/people/controllers/member-registrations.controller";
import { StudentsController } from "@modules/people/controllers/students.controller";
import { AuthService } from "@modules/auth/services/auth.service";
import { InvitesService } from "@modules/auth/services/invites.service";
import { AccessService } from "@modules/auth/services/access.service";
import { DepartmentsService } from "@modules/people/services/departments.service";
import { MembersService } from "@modules/people/services/members.service";
import { StudentsService } from "@modules/people/services/students.service";
import { LoginThrottlerGuard } from "@modules/auth/guards/login-throttler.guard";

const THROTTLER_OPTIONS_TOKEN = "THROTTLER:MODULE_OPTIONS";

@Module({
  controllers: [
    HealthController,
    AuthController,
    InvitesController,
    AccessController,
    StudentsController,
    MemberRegistrationsController,
    DepartmentsController,
  ],
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
      provide: InvitesService,
      useValue: {
        create: async () => ({}),
        getByToken: async () => ({}),
        getPublicView: async () => ({}),
        accept: async () => undefined,
        list: async () => [],
        revoke: async () => undefined,
        createPasswordReset: async () => ({}),
      },
    },
    {
      provide: AccessService,
      useValue: {
        listAccess: async () => ({ data: [], total: 0, page: 1, limit: 20 }),
        updateRole: async () => ({}),
        updateEnabled: async () => ({}),
        createPasswordReset: async () => ({}),
      },
    },
    {
      provide: StudentsService,
      useValue: {
        create: async () => ({}),
        update: async () => ({}),
        archive: async () => ({}),
        unarchive: async () => ({}),
        findByIds: async () => [],
        findDetail: async () => ({}),
      },
    },
    {
      provide: MembersService,
      useValue: {
        submitFromInvite: async () => ({}),
        findAccessFacts: async () => ({ registrationStatus: null, departmentIds: [] }),
        listRegistrations: async () => ({ data: [], total: 0, page: 1, limit: 20 }),
        getRegistration: async () => ({}),
        approve: async () => ({}),
        reject: async () => ({}),
      },
    },
    {
      provide: DepartmentsService,
      useValue: { list: async () => [], create: async () => ({}), exists: async () => false },
    },
    {
      provide: ConfigService,
      useValue: { getOrThrow: () => "http://localhost:5173" },
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
