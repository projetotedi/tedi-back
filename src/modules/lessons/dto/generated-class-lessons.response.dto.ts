import { ApiProperty } from "@nestjs/swagger";
import { LessonResponseDto } from "./lesson.response.dto";

/**
 * The lessons that `POST /classes/:id/lessons/generate` created, all of one class, in the order of
 * the sequence of its course. An object and not a bare array so it can grow (a count, the plans
 * that were skipped) without breaking the client.
 */
export class GeneratedClassLessonsResponseDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-0000000000c1" })
  classId!: string;

  @ApiProperty({
    type: [LessonResponseDto],
    description:
      "The lessons created, planned, in the order of the sequence (so by date). Each one is the same LessonResponseDto the other routes of the module answer.",
  })
  lessons!: LessonResponseDto[];
}
