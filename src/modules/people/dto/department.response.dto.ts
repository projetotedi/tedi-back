import { ApiProperty } from "@nestjs/swagger";

/** Department as returned by the API (GET /departments and the lists inside registrations). */
export class DepartmentResponseDto {
  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01999a3e-1111-7000-8000-000000000001",
  })
  id!: string;

  @ApiProperty({ type: String, example: "Tecnologia" })
  name!: string;
}
