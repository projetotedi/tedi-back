import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsOptional, IsString, MinLength, ValidateNested } from "class-validator";
import { MemberRegistrationFormDto } from "@modules/people/dto/member-registration-form.dto";

/**
 * DTO for accepting an invite.
 *
 * `token` and `password` are always required.
 * `registration` is the member registration form (RF-004, GUS-91). Its necessity depends on
 * the invite type — access invites require it, password_reset invites ignore it — and the DTO
 * does not know the type, so the presence check lives in InvitesService.accept. When present,
 * it is validated whole: errors come out as `registration.cpf`, `registration.state`, etc.
 *
 * `name`, `ra` and `email` no longer exist at the top level: they moved into `registration`.
 */
export class AcceptInviteDto {
  @ApiProperty({ example: "eyJ..." })
  @IsString()
  token!: string;

  @ApiProperty({ example: "Senha@123", minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiPropertyOptional({
    type: () => MemberRegistrationFormDto,
    description:
      "Member registration (RF-004). Required for access invites; ignored for password_reset.",
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => MemberRegistrationFormDto)
  registration?: MemberRegistrationFormDto;
}
