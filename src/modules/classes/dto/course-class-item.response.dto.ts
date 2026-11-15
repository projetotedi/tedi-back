import { ApiProperty } from "@nestjs/swagger";
import { ClassStatus } from "../enums/class-status.enum";
import { EditionResponseDto } from "./edition.response.dto";

/**
 * A class in the list "Turmas deste curso" of the course: what the table of the sheet shows, and
 * nothing of the course, which every row shares. The full class is `ClassResponseDto`.
 */
export class CourseClassItemResponseDto {
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

  @ApiProperty({ type: EditionResponseDto })
  edition!: EditionResponseDto;

  @ApiProperty({ type: String, format: "date", example: "2026-03-03" })
  startDate!: string;

  @ApiProperty({ type: String, format: "date", example: "2026-06-27" })
  endDate!: string;

  @ApiProperty({
    type: "integer",
    minimum: 0,
    example: 12,
    description: "Active enrollments of the class. Always 0 until the enrollments exist (GUS-108).",
  })
  enrolledCount!: number;

  @ApiProperty({ type: "integer", example: 15, description: "Number of seats." })
  capacity!: number;

  @ApiProperty({
    enum: ClassStatus,
    enumName: "ClassStatus",
    example: ClassStatus.IN_PROGRESS,
    description: "Status of the class now (RF-034).",
  })
  status!: ClassStatus;
}
