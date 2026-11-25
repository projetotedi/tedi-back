import { ApiProperty } from "@nestjs/swagger";
import { Role } from "@shared/enums/role.enum";
import { Permission } from "@shared/permissions/permission.enum";
import { PermissionsDto } from "@shared/permissions/permissions.dto";
import { Scope } from "@shared/permissions/scope.type";

export class MeResponseDto {
  @ApiProperty({ example: "01952ef7-0000-7000-8000-000000000001" })
  id!: string;

  @ApiProperty({ example: "Alice Silva" })
  name!: string;

  @ApiProperty({ example: "a2210001", nullable: true })
  ra!: string | null;

  @ApiProperty({ example: "alice@example.com", nullable: true })
  email!: string | null;

  @ApiProperty({ enum: Role, enumName: "Role" })
  role!: Role;

  @ApiProperty({
    type: () => PermissionsDto,
    description:
      "Scope per permission for the logged-in role (source: PERMISSION_MATRIX, docs/PERMISSIONS.md).",
  })
  permissions!: Record<Permission, Scope>;

  @ApiProperty({
    example: false,
    description:
      "True while the account still has to replace its password (initial coordinator, GUS-93). " +
      "Until POST /auth/password succeeds, every authenticated route except GET /auth/me and " +
      "POST /auth/password answers 403 PASSWORD_CHANGE_REQUIRED.",
  })
  mustChangePassword!: boolean;
}
