import { ApiProperty } from "@nestjs/swagger";
import { IsEnum } from "class-validator";
import { Role } from "@shared/enums/role.enum";

export class UpdateAccessRoleDto {
  @ApiProperty({ enum: Role, enumName: "Role", example: "coordinator" })
  @IsEnum(Role)
  role!: Role;
}
