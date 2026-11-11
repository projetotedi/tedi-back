import { ApiProperty } from "@nestjs/swagger";
import { ClassStatus } from "../enums/class-status.enum";
import { EditionResponseDto } from "./edition.response.dto";

export class ClassResponseDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-0000000000c1" })
  id!: string;

  @ApiProperty({ type: String, example: "INFO-A", description: "Unique inside its edition." })
  code!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "Informática Básica, turma A",
    description: "Optional label. Null when not informed.",
  })
  name!: string | null;

  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01999a3e-7c1b-7000-8000-000000000001",
    description: "Id of the course this class offers. It never changes (RN-13).",
  })
  courseId!: string;

  @ApiProperty({ type: EditionResponseDto })
  edition!: EditionResponseDto;

  @ApiProperty({ type: String, format: "date", example: "2026-03-03" })
  startDate!: string;

  @ApiProperty({ type: String, format: "date", example: "2026-06-27" })
  endDate!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "Laboratório 3, bloco B",
    description: "Null when not informed.",
  })
  location!: string | null;

  @ApiProperty({ type: "integer", example: 15, description: "Number of seats." })
  capacity!: number;

  @ApiProperty({
    enum: ClassStatus,
    enumName: "ClassStatus",
    example: ClassStatus.PLANNED,
    description: "Independent of archiving: an archived class keeps its status (RF-034, RN-27).",
  })
  status!: ClassStatus;

  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    example: null,
    description: "Null while the class is active (RN-27).",
  })
  archivedAt!: Date | null;

  @ApiProperty({ type: String, format: "uuid", nullable: true, example: null })
  archivedById!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  archiveReason!: string | null;

  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01999a3e-0000-7000-8000-0000000000aa",
    description: "Id of the person who created the class.",
  })
  createdById!: string;

  @ApiProperty({ type: String, format: "date-time", example: "2026-10-01T13:00:00.000Z" })
  createdAt!: Date;

  @ApiProperty({ type: String, format: "date-time", example: "2026-10-01T13:00:00.000Z" })
  updatedAt!: Date;
}
