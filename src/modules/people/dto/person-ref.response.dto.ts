import { ApiProperty } from "@nestjs/swagger";

/**
 * Id and name of a Person. Nothing else: no e-mail, RA, role or access data. Part of the contract
 * of PeopleService (findRefsByIds): it is how another module shows who did something.
 */
export class PersonRefDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-0000-7000-8000-0000000000aa" })
  id!: string;

  @ApiProperty({ type: String, example: "Carla Menezes" })
  name!: string;
}
