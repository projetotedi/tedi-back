import { ApiProperty } from "@nestjs/swagger";

/**
 * Account owner shown on the password reset screen.
 * Only name and RA are exposed — never id, email, role or password hash.
 */
export class InvitePersonDto {
  @ApiProperty({ type: String, example: "Beatriz Nunes Carvalho" })
  name!: string;

  @ApiProperty({ type: String, example: "202400003" })
  ra!: string;
}
