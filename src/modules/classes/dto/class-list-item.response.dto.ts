import { ApiProperty } from "@nestjs/swagger";
import { ClassStatus } from "../enums/class-status.enum";
import { ClassCourseResponseDto } from "./class-course.response.dto";
import { EditionResponseDto } from "./edition.response.dto";

/** A line of the list of classes (GUS-103). */
export class ClassListItemDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-0000000000c1" })
  id!: string;

  @ApiProperty({ type: String, example: "INFO-A" })
  code!: string;

  @ApiProperty({ type: String, nullable: true, example: "Informática Básica — A" })
  name!: string | null;

  @ApiProperty({
    type: () => ClassCourseResponseDto,
    description: "The course of the class, with its current category (RN-14).",
  })
  course!: ClassCourseResponseDto;

  @ApiProperty({ type: () => EditionResponseDto })
  edition!: EditionResponseDto;

  @ApiProperty({ type: String, format: "date", example: "2026-03-03" })
  startDate!: string;

  @ApiProperty({ type: String, format: "date", example: "2026-06-27" })
  endDate!: string;

  @ApiProperty({
    type: Number,
    example: 12,
    minimum: 0,
    description: "Active enrollments only (0 until the enrollments of GUS-108 exist).",
  })
  enrolledCount!: number;

  @ApiProperty({ type: Number, example: 15, minimum: 1 })
  capacity!: number;

  @ApiProperty({ enum: ClassStatus, enumName: "ClassStatus", example: ClassStatus.PLANNED })
  status!: ClassStatus;

  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    example: null,
    description: "Null while the class is not archived (RN-27).",
  })
  archivedAt!: Date | null;
}
