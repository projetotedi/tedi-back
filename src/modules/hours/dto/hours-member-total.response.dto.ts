import { ApiProperty } from "@nestjs/swagger";
import { MemberRefDto } from "@modules/people/dto/member-ref.response.dto";

/** The entries of one member in the period, as a line of the overview. Removed entries are out. */
export class HoursMemberTotalDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-0000-7000-8000-0000000000aa" })
  personId!: string;

  @ApiProperty({
    type: () => MemberRefDto,
    nullable: true,
    description:
      "Name and department of the member (approved registration). Null when the person is no longer found.",
  })
  member!: MemberRefDto | null;

  @ApiProperty({ type: "integer", example: 4, description: "How many entries, of any status." })
  entries!: number;

  @ApiProperty({
    type: "integer",
    example: 600,
    description: "Declared minutes of every entry: what was logged.",
  })
  declaredMinutes!: number;

  @ApiProperty({
    type: "integer",
    example: 180,
    description: "Validated minutes of the approved and adjusted entries: what is in the bank.",
  })
  bankMinutes!: number;

  @ApiProperty({ type: "integer", example: 1, description: "How many entries are pending." })
  pendingEntries!: number;

  @ApiProperty({
    type: "integer",
    example: 90,
    description: "Declared minutes of the pending entries: what waits for review.",
  })
  pendingMinutes!: number;
}
