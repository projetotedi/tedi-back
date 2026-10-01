import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsString, MinLength } from "class-validator";

export class LoginDto {
  @ApiProperty({ example: "a2210001", description: "Academic Registration (RA)" })
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  ra!: string;

  @ApiProperty({ example: "Senha@123", minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;
}
