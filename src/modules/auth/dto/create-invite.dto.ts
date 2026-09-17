import { ApiProperty } from "@nestjs/swagger";
import { IsEnum } from "class-validator";
import { Role } from "@shared/enums/role.enum";

export class CreateInviteDto {
  @ApiProperty({
    enum: Role,
    enumName: "Role",
    description: "Role to assign to the invited person. SUPERADMIN is not allowed.",
    example: Role.MEMBER,
  })
  @IsEnum(Role)
  role!: Role;
}
