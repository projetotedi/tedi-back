import { ApiProperty } from "@nestjs/swagger";
import { AssignmentLessonRefDto } from "./assignment-lesson-ref.response.dto";

/** The class of a lesson, as the agenda of the member shows it. */
export class AssignmentClassRefDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-0000000000c1" })
  id!: string;

  @ApiProperty({ type: String, example: "INFO-A" })
  code!: string;

  @ApiProperty({
    type: String,
    example: "Informática Básica, turma A",
    description: "The name of the class or, when it has none, its code: never null.",
  })
  name!: string;
}

/**
 * The lesson as "Minhas aulas", the lessons with an open place and the pending applications show it
 * (GUS-160): the reference of the list of a member, plus the position in the sequence ("Aula 3"),
 * the place and the class.
 */
export class AssignmentLessonResponseDto extends AssignmentLessonRefDto {
  @ApiProperty({
    type: "integer",
    nullable: true,
    example: 3,
    description:
      'The position of the plan of the lesson in the sequence of the course (the 3 of "Aula 3"). Null for a lesson on its own.',
  })
  sequenceOrder!: number | null;

  @ApiProperty({ type: String, nullable: true, example: "Laboratório 2" })
  location!: string | null;

  @ApiProperty({ type: () => AssignmentClassRefDto })
  class!: AssignmentClassRefDto;
}
