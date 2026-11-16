import { ApiProperty } from "@nestjs/swagger";
import { HourEntryCategory } from "../enums/hour-entry-category.enum";
import { HourEntryOrigin } from "../enums/hour-entry-origin.enum";
import { HourEntryStatus } from "../enums/hour-entry-status.enum";

/** One hour entry, as the statement of the person shows it and as the two logging routes answer. */
export class HourEntryResponseDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-000000000a01" })
  id!: string;

  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01999a3e-0000-7000-8000-0000000000aa",
    description: "Whose hours these are.",
  })
  personId!: string;

  @ApiProperty({ type: String, example: "Planejamento da aula de teclado e mouse" })
  activity!: string;

  @ApiProperty({
    enum: HourEntryCategory,
    enumName: "HourEntryCategory",
    example: HourEntryCategory.PLANNING,
  })
  category!: HourEntryCategory;

  @ApiProperty({
    type: String,
    format: "date",
    example: "2026-03-10",
    description: "Day of the work, YYYY-MM-DD.",
  })
  date!: string;

  @ApiProperty({
    type: "integer",
    example: 150,
    description: "Minutes the person declares (150 = 2h30).",
  })
  declaredMinutes!: number;

  @ApiProperty({
    type: "integer",
    nullable: true,
    example: null,
    description: "Minutes accepted by coordination. Null until coordination reviews the entry.",
  })
  validatedMinutes!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "Revisei os exercícios do plano 3.",
    description: "Free notes of the person. Null when there are none.",
  })
  notes!: string | null;

  @ApiProperty({
    enum: HourEntryStatus,
    enumName: "HourEntryStatus",
    example: HourEntryStatus.PENDING,
    description:
      "pending until coordination reviews it; approved, adjusted (approved with other minutes) or rejected afterwards. Only a pending entry can be removed.",
  })
  status!: HourEntryStatus;

  @ApiProperty({
    enum: HourEntryOrigin,
    enumName: "HourEntryOrigin",
    example: HourEntryOrigin.MANUAL,
    description:
      "manual: logged by the person; on_behalf: logged by someone else for her; attendance: created by the confirmed attendance of a lesson.",
  })
  origin!: HourEntryOrigin;

  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01999a3e-0000-7000-8000-0000000000aa",
    description: "Who logged it: the person herself, or whoever logged it on her behalf.",
  })
  createdById!: string;

  @ApiProperty({
    type: String,
    format: "uuid",
    nullable: true,
    example: null,
    description: "The class of the lesson, for an entry created by the attendance.",
  })
  classId!: string | null;

  @ApiProperty({
    type: String,
    format: "uuid",
    nullable: true,
    example: null,
    description: "The lesson, for an entry created by the attendance.",
  })
  lessonId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: "Justification of an adjustment or reason of a rejection. Null otherwise.",
  })
  reviewNote!: string | null;

  @ApiProperty({
    type: String,
    format: "uuid",
    nullable: true,
    example: null,
    description: "Id of the person who reviewed the entry. Null while it is pending.",
  })
  reviewedById!: string | null;

  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    example: null,
    description: "When the entry was reviewed. Null while it is pending.",
  })
  reviewedAt!: Date | null;

  @ApiProperty({ type: String, format: "date-time", example: "2026-03-10T21:00:00.000Z" })
  createdAt!: Date;

  @ApiProperty({ type: String, format: "date-time", example: "2026-03-10T21:00:00.000Z" })
  updatedAt!: Date;
}
