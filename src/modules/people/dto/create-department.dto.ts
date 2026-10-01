import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";
import { trim } from "@shared/dto/transforms";

/** Body of POST /departments. The name is unique, ignoring case. */
export class CreateDepartmentDto {
  @ApiProperty({
    type: String,
    maxLength: 100,
    example: "Tecnologia",
    description: "Trimmed. Unique among departments, ignoring case.",
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;
}
