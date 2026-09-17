import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEmail, IsString, MinLength } from "class-validator";

export class AcceptInviteDto {
  @ApiProperty({ example: "eyJ..." })
  @IsString()
  token!: string;

  @ApiProperty({ example: "Alice Silva" })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: "a2210001" })
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  ra!: string;

  @ApiProperty({ example: "alice@example.com" })
  @IsEmail()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  email!: string;

  @ApiProperty({ example: "Senha@123", minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;
}
