import { ApiProperty } from "@nestjs/swagger";
import { MemberRefDto } from "@modules/people/dto/member-ref.response.dto";
import { HourEntryResponseDto } from "./hour-entry.response.dto";

/** An hour entry of the queue of validation, with whose it is. */
export class MemberHourEntryResponseDto extends HourEntryResponseDto {
  @ApiProperty({
    type: () => MemberRefDto,
    nullable: true,
    description:
      "The person of the entry, with the department of her approved member registration. Null when she is no longer found.",
  })
  member!: MemberRefDto | null;
}
