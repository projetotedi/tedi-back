import { ApiProperty } from "@nestjs/swagger";
import { Role } from "@shared/enums/role.enum";

export class CreateInviteResponseDto {
  @ApiProperty({ example: "01952ef7-0000-7000-8000-000000000001" })
  id!: string;

  @ApiProperty({ enum: Role, enumName: "Role", nullable: true })
  role!: Role | null;

  @ApiProperty({ example: "2026-09-19T12:00:00.000Z" })
  expiresAt!: Date;

  @ApiProperty({
    example: "https://tedi-front.vercel.app/invite?token=abc123",
    description: "Full URL for the invite page. Includes the plain-text token — share with care.",
  })
  url!: string;
}
