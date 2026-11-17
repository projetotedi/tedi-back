import { ApiProperty } from "@nestjs/swagger";
import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";
import { ClassStatus } from "../enums/class-status.enum";
import { ClassDetailCourseResponseDto } from "./class-detail-course.response.dto";
import { ClassDetailSummaryResponseDto } from "./class-detail-summary.response.dto";
import { ClassEnrollmentPreviewItemResponseDto } from "./class-enrollment-preview-item.response.dto";
import { EditionResponseDto } from "./edition.response.dto";

/**
 * Sheet of a class (GUS-104): the data of the offering, the course it comes from with its current
 * category and the size of its plan, the progress of the class and a preview of its students, all
 * in one call (RF-035). An archived class is read the same way, with `archivedAt` set (RN-27).
 * The classes of a course are `GET /courses/{id}/classes` and the list of enrollments is
 * `GET /classes/{id}/enrollments`.
 */
export class ClassDetailDto {
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
    description: "Set when archived: the class is then read-only (RN-27). Null while active.",
  })
  archivedAt!: Date | null;

  @ApiProperty({ type: String, format: "date-time", example: "2026-10-01T13:00:00.000Z" })
  createdAt!: Date;

  @ApiProperty({
    type: () => PersonRefDto,
    nullable: true,
    description: "Null when the person who created the class was removed.",
  })
  createdBy!: PersonRefDto | null;

  @ApiProperty({
    type: ClassDetailCourseResponseDto,
    description:
      "The course this class offers, read now: its category is the one of the course (RN-14, RF-029), and changing it there changes it here.",
  })
  course!: ClassDetailCourseResponseDto;

  @ApiProperty({ type: ClassDetailSummaryResponseDto })
  summary!: ClassDetailSummaryResponseDto;

  @ApiProperty({
    type: [ClassEnrollmentPreviewItemResponseDto],
    description:
      "Up to 5 active enrollments, the earliest first. The full list is GET /classes/{id}/enrollments. Empty when there are none.",
  })
  enrollmentsPreview!: ClassEnrollmentPreviewItemResponseDto[];

  @ApiProperty({
    type: "integer",
    minimum: 0,
    example: 12,
    description: "Active enrollments of the class, the same as summary.enrolledCount.",
  })
  enrollmentsTotal!: number;
}
