import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Role } from "@shared/enums/role.enum";
import { InviteType } from "../entities/invite.entity";

/**
 * Represents an invite in the list response.
 * Never exposes tokenHash.
 */
export class InviteListItemDto {
  @ApiProperty({ example: "01952ef7-0000-7000-8000-000000000001" })
  id!: string;

  @ApiProperty({ enum: InviteType, enumName: "InviteType" })
  type!: InviteType;

  @ApiProperty({ enum: Role, enumName: "Role", nullable: true })
  role!: Role | null;

  @ApiPropertyOptional({ example: "01952ef7-0000-7000-8000-000000000002", nullable: true })
  personId!: string | null;

  @ApiProperty({
    example: "pending",
    enum: ["pending", "used", "expired", "revoked"],
    description: "Computed invite status",
  })
  status!: string;

  @ApiProperty({ example: "2026-09-19T12:00:00.000Z" })
  expiresAt!: Date;

  @ApiProperty({ example: "2026-09-17T10:00:00.000Z" })
  createdAt!: Date;
}
