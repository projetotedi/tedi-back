import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";
import { trim } from "@shared/dto/transforms";

/** Body of PATCH /member-registrations/:id/reject. The note is mandatory. */
export class RejectMemberRegistrationDto {
  @ApiProperty({
    type: String,
    maxLength: 500,
    example: "O RA informado não confere com o termo de voluntariado.",
    description:
      "Why the registration was rejected, kept in the audit event. Do not record sensitive data in it.",
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note!: string;
}
