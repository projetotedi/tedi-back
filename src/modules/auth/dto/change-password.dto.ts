import { ApiProperty } from "@nestjs/swagger";
import { IsString, MinLength } from "class-validator";

/**
 * Body of POST /auth/password (GUS-93). Only the new password: the session already proves who is
 * asking, and the route exists for the first access, when the current password is the one the
 * operator set in ADMIN_PASSWORD.
 */
export class ChangePasswordDto {
  @ApiProperty({
    example: "NovaSenha@123",
    minLength: 8,
    description: "New password. At least 8 characters, and different from the current one.",
  })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
