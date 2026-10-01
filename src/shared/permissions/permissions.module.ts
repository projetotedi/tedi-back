import { Module } from "@nestjs/common";
import { PermissionPolicy } from "./permission.policy";

/**
 * Not global: each domain module that needs scope checks imports this module.
 * The AuthGuard does not need it (it uses the pure scopeFor() function).
 */
@Module({
  providers: [PermissionPolicy],
  exports: [PermissionPolicy],
})
export class PermissionsModule {}
