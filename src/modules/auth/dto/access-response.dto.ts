import { ApiProperty } from "@nestjs/swagger";
import { Role } from "@shared/enums/role.enum";

/**
 * Response shape for access management endpoints (updateRole, updateEnabled).
 * Maps directly to fields on the Person entity relevant to access management.
 */
export class AccessResponseDto {
  @ApiProperty({ example: "01952ef7-0000-7000-8000-000000000001" })
  id!: string;

  @ApiProperty({ example: "Alice Silva" })
  name!: string;

  @ApiProperty({ example: "a2210001" })
  ra!: string | null;

  @ApiProperty({ example: "alice@example.com" })
  email!: string | null;

  @ApiProperty({ enum: Role, enumName: "Role", nullable: true })
  role!: Role | null;

  @ApiProperty({ example: true })
  accessEnabled!: boolean;
}
