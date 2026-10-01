import { ApiProperty } from "@nestjs/swagger";
import { PERMISSION_CATALOG } from "./permission-catalog";
import { Permission } from "./permission.enum";
import { SCOPES } from "./scope.type";

/**
 * Swagger-only class: one required property per Permission, typed as Scope.
 * The TypeScript type of the map is `Record<Permission, Scope>` on the parent DTO.
 * The properties are declared in a loop so the matrix stays the single list of permissions.
 */
export class PermissionsDto {}

for (const permission of Object.values(Permission)) {
  ApiProperty({
    enum: SCOPES,
    enumName: "Scope",
    description: PERMISSION_CATALOG[permission].action,
  })(PermissionsDto.prototype, permission);
}
