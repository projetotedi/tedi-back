import { ApiProperty } from "@nestjs/swagger";
import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";
import { HourEntryEventType } from "../enums/hour-entry-event-type.enum";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";

/** One row of the history of an hour entry: who did what, when, and from what to what. */
export class HourEntryEventResponseDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-000000000e01" })
  id!: string;

  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-000000000a01" })
  hourEntryId!: string;

  @ApiProperty({
    enum: HourEntryEventType,
    enumName: "HourEntryEventType",
    example: HourEntryEventType.ADJUSTED,
    description:
      "created, approved, adjusted, rejected, removed or reversed. reversed: the hours of a presence were reversed, by a correction of the attendance or the cancellation of the lesson. The history cannot be edited or deleted.",
  })
  type!: HourEntryEventType;

  @ApiProperty({
    type: () => PersonRefDto,
    nullable: true,
    description: "Who did it. Null when the person was removed.",
  })
  actor!: PersonRefDto | null;

  @ApiProperty({
    enum: HourEntryStatus,
    enumName: "HourEntryStatus",
    nullable: true,
    example: HourEntryStatus.PENDING,
    description: "The status before; null for a creation.",
  })
  fromStatus!: HourEntryStatus | null;

  @ApiProperty({
    enum: HourEntryStatus,
    enumName: "HourEntryStatus",
    nullable: true,
    example: HourEntryStatus.ADJUSTED,
    description: "The status after; null for a removal.",
  })
  toStatus!: HourEntryStatus | null;

  @ApiProperty({
    type: "integer",
    nullable: true,
    example: 240,
    description: "The minutes before (declared, for a review or a removal); null for a creation.",
  })
  fromMinutes!: number | null;

  @ApiProperty({
    type: "integer",
    nullable: true,
    example: 120,
    description:
      "The minutes after (declared for a creation, validated for a review); null for a removal.",
  })
  toMinutes!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "A reunião durou duas horas, conforme a ata.",
    description: "The justification of an adjustment or the reason of a rejection. Null otherwise.",
  })
  note!: string | null;

  @ApiProperty({
    type: String,
    format: "date-time",
    example: "2026-03-12T13:00:00.000Z",
    description: "When it happened.",
  })
  createdAt!: Date;
}
