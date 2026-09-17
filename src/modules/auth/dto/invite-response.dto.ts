import { ApiProperty } from "@nestjs/swagger";
import { Role } from "@shared/enums/role.enum";
import { InviteType } from "../entities/invite.entity";

export class InviteResponseDto {
  @ApiProperty({ enum: InviteType, enumName: "InviteType" })
  type!: InviteType;

  @ApiProperty({ enum: Role, enumName: "Role", nullable: true })
  role!: Role | null;

  @ApiProperty({ example: "2026-09-19T12:00:00.000Z" })
  expiresAt!: Date;
}
