import { ApiProperty } from "@nestjs/swagger";
import { Role } from "@shared/enums/role.enum";

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
}
