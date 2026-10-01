import { ApiProperty } from "@nestjs/swagger";

/**
 * Response for POST /access/:id/password-reset.
 * Contains the reset URL (with token) and expiration.
 */
export class PasswordResetResponseDto {
  @ApiProperty({
    example: "https://tedi-front.vercel.app/reset-password?token=abc123",
    description: "Full URL for the password-reset page. Includes the plain-text token.",
  })
  url!: string;

  @ApiProperty({ example: "2026-09-19T12:00:00.000Z" })
  expiresAt!: Date;
}
