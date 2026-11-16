import { ApiProperty } from "@nestjs/swagger";

/**
 * A person on a lesson (the teacher of a row of the list, from the allocation on, GUS-158): the
 * id and the name, nothing else of the person.
 */
export class LessonPersonRefDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-0000-7000-8000-0000000000aa" })
  id!: string;

  @ApiProperty({ type: String, example: "Maria Silva Santos" })
  name!: string;
}
