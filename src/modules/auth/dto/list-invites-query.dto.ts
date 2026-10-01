import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional } from "class-validator";
import { InviteStatus } from "../services/invites.service";

export class ListInvitesQueryDto {
  @ApiPropertyOptional({
    example: "pending",
    enum: ["pending", "used", "expired", "revoked"],
    description: "Filter by computed status",
  })
  @IsOptional()
  @IsEnum(["pending", "used", "expired", "revoked"])
  status?: InviteStatus;
}
