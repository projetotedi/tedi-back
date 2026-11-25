import { ApiProperty } from "@nestjs/swagger";

/** The course that the class of a lesson offers. */
export class LessonCourseRefDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-000000000001" })
  id!: string;

  @ApiProperty({ type: String, example: "Informática Básica" })
  name!: string;
}
