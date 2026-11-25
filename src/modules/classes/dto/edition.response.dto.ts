import { ApiProperty } from "@nestjs/swagger";

export class EditionResponseDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-0000000000e1" })
  id!: string;

  @ApiProperty({
    type: String,
    example: "2026.1",
    description: 'Year and term, "<year>.<term>".',
  })
  name!: string;
}
