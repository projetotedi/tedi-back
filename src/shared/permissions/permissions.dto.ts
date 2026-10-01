import { ApiProperty } from "@nestjs/swagger";
import { Permission } from "./permission.enum";
import { SCOPES } from "./scope.type";

/**
 * Swagger-only class: one required property per Permission, typed as Scope.
 * The TypeScript type of the map is `Record<Permission, Scope>` on the parent DTO.
 * The properties are declared in a loop so the matrix stays the single list of permissions.
 *
 * No per-property `description`: NestJS copies the first property's metadata into the shared
 * `Scope` schema, which would leak one permission's label into the enum. The human labels live
 * in PERMISSION_CATALOG and docs/PERMISSIONS.md.
 */
export class PermissionsDto {}

for (const permission of Object.values(Permission)) {
  ApiProperty({ enum: SCOPES, enumName: "Scope" })(PermissionsDto.prototype, permission);
}
