import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth.module";
import { PeopleModule } from "@modules/people/people.module";
import { ProtectedController } from "./protected.controller";

/**
 * Minimal module for the AuthGuard e2e tests.
 * Imports AuthModule (which registers APP_GUARD) and PeopleModule.
 */
@Module({
  imports: [AuthModule, PeopleModule],
  controllers: [ProtectedController],
})
export class TestModule {}
