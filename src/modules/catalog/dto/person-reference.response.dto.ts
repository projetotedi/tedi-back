import { ApiProperty } from "@nestjs/swagger";

/** Id and name of a Person, nothing else: no e-mail, RA, role or access data. */
export class PersonReferenceResponseDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-0000-7000-8000-0000000000aa" })
  id!: string;

  @ApiProperty({ type: String, example: "Carla Menezes" })
  name!: string;
}
