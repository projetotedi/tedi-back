import { ApiProperty } from "@nestjs/swagger";
import { DepartmentResponseDto } from "./department.response.dto";

/**
 * Id, name and department of a member. Nothing else: no e-mail, RA, role or registration data.
 * Part of the contract of MembersService (findMemberRefs): it is how another module (hours) shows
 * whose something is and filters by department, without reading the tables of people.
 */
export class MemberRefDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-0000-7000-8000-0000000000aa" })
  id!: string;

  @ApiProperty({ type: String, example: "Ana Souza" })
  name!: string;

  @ApiProperty({
    type: () => DepartmentResponseDto,
    nullable: true,
    description:
      "The department of the approved member registration; null without one (coordination without a member profile, a registration that is not approved, or no department).",
  })
  department!: DepartmentResponseDto | null;
}
