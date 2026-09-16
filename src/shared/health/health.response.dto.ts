import { ApiProperty } from "@nestjs/swagger";

export class HealthResponseDto {
  @ApiProperty({ enum: ["ok", "error"], example: "ok" })
  status!: "ok" | "error";

  @ApiProperty({ enum: ["up", "down"], example: "up" })
  database!: "up" | "down";

  @ApiProperty({ example: 1234 })
  uptimeSeconds!: number;

  @ApiProperty({ example: "2026-09-16T12:00:00.000Z" })
  timestamp!: string;
}
