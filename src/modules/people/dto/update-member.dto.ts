import {
  ApiPropertyOptional,
  ApiSchema,
  IntersectionType,
  PartialType,
  PickType,
} from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEmail, IsUUID, MaxLength, ValidateIf } from "class-validator";
import { trimLowerToNull } from "@shared/dto/transforms";
import { ApproveMemberRegistrationDto } from "./approve-member-registration.dto";
import { MemberRegistrationFormDto } from "./member-registration-form.dto";

/**
 * Body of PATCH /members/:id (GUS-146): the fields of the "Editar membro" modal, with the
 * validators of the sign-up (MemberRegistrationFormDto) and of the approval (mainFunction,
 * joinedAt). Omitted keeps. `skipNullProperties: false` turns the inherited required fields into
 * "omit to keep, never null" (null and blank answer 400); address, city, state and
 * volunteerTermUrl keep their own @IsOptional, so null clears them.
 *
 * `email` (the personal e-mail, Person.email) and `departmentId` are declared here: the sign-up
 * names the e-mail `personalEmail`, while the member record answers `email`; and the inherited
 * `departmentId` would take null. role, accessEnabled and the participation are not here: the
 * whitelist drops them (they have their own routes).
 */
@ApiSchema({
  description:
    "Every field is optional: omit to keep. Null clears address, city, state and volunteerTermUrl; every other field is never null. The access profile (role) and the access are not edited here: see PATCH /access/:id/role and /enabled.",
})
export class UpdateMemberDto extends PartialType(
  IntersectionType(
    PickType(MemberRegistrationFormDto, [
      "name",
      "ra",
      "birthDate",
      "cpf",
      "phone",
      "address",
      "city",
      "state",
      "institutionalEmail",
      "course",
      "semester",
      "className",
      "volunteerTermUrl",
    ] as const),
    PickType(ApproveMemberRegistrationDto, ["mainFunction", "joinedAt"] as const),
  ),
  { skipNullProperties: false },
) {
  @ApiPropertyOptional({
    type: String,
    maxLength: 200,
    example: "ana.torres@example.com",
    description:
      "Personal e-mail. Omit to keep. Never null. Trimmed and lower-cased; unique among people (409 EMAIL_ALREADY_IN_USE).",
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trimLowerToNull)
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @ApiPropertyOptional({
    type: String,
    format: "uuid",
    example: "01999a3e-1111-7000-8000-000000000001",
    description:
      "Omit to keep. Never null. A director can only keep the department of the member (403 DEPARTMENT_SCOPE); an unknown id answers 400 DEPARTMENT_NOT_FOUND.",
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trimLowerToNull)
  @IsUUID("all")
  departmentId?: string;
}
