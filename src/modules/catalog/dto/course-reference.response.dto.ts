import { ApiProperty } from "@nestjs/swagger";

/** A course seen from another course: today, a prerequisite (RF-021). */
export class CourseReferenceResponseDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-000000000001" })
  id!: string;

  @ApiProperty({ type: String, example: "Informática Básica" })
  name!: string;
}
