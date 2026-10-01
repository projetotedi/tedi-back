import { Module } from "@nestjs/common";
import { PermissionsModule } from "@shared/permissions/permissions.module";
import { PeopleModule } from "@modules/people/people.module";
import { AuthModule } from "../../auth.module";
import { PermissionDemoController } from "./permission-demo.controller";

/**
 * Minimal module for the permissions e2e (GUS-114).
 * Imports AuthModule (which registers APP_GUARD), PeopleModule and PermissionsModule,
 * and registers the demo controller that stands in for the future domain modules.
 */
@Module({
  imports: [AuthModule, PeopleModule, PermissionsModule],
  controllers: [PermissionDemoController],
})
export class PermissionsTestModule {}
