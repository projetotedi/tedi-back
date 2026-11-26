import { ApiProperty } from "@nestjs/swagger";
import { EditionResponseDto } from "./edition.response.dto";

/**
 * A class as the enrollments show it: the code, the optional name and the edition, which tells
 * apart the same code in different terms.
 */
export class EnrollmentClassRefResponseDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-0000000000c1" })
  id!: string;

  @ApiProperty({ type: String, example: "INFO-A" })
  code!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  name!: string | null;

  @ApiProperty({ type: () => EditionResponseDto })
  edition!: EditionResponseDto;
}
