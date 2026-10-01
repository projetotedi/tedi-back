import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/**
 * DTO for accepting an invite.
 *
 * `token` and `password` are always required.
 * `name`, `ra`, and `email` are optional at the DTO level because their
 * necessity depends on the invite type — PASSWORD_RESET ignores them,
 * ACCESS requires them (enforced in InvitesService.accept).
 */
export class AcceptInviteDto {
  @ApiProperty({ example: "eyJ..." })
  @IsString()
  token!: string;

  @ApiPropertyOptional({ example: "Alice Silva", maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ example: "a2210001" })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  ra?: string;

  @ApiPropertyOptional({ example: "alice@example.com" })
  @IsOptional()
  @IsEmail()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  email?: string;

  @ApiProperty({ example: "Senha@123", minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;
}
