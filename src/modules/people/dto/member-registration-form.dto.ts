import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { trim, trimLowerToNull, trimToNull } from "@shared/dto/transforms";
import { BRAZILIAN_STATES, normalizeState } from "../validators/brazilian-state";
import { IsCpf, normalizeCpf } from "../validators/cpf";
import { IsBirthDate } from "../validators/is-birth-date.validator";
import { normalizePhone, PHONE_DIGITS } from "../validators/phone";

/**
 * The `registration` object of POST /auth/invites/accept (RF-004, RF-011): the member
 * registration filled in by the person. It is the input contract of
 * MembersService.submitFromInvite.
 *
 * Required: name, ra, personalEmail, birthDate, cpf, phone, institutionalEmail, course,
 * semester and className. Address, city, state, department and the volunteer term are optional.
 * CPF, address and phone are personal data (RNF-13/14): never logged, never in events.
 */
export class MemberRegistrationFormDto {
  @ApiProperty({ type: String, maxLength: 200, example: "Ana Torres" })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({
    type: String,
    maxLength: 20,
    example: "a2210001",
    description: "Trimmed and lower-cased. It is the login (RN-09).",
  })
  @Transform(trimLowerToNull)
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  ra!: string;

  @ApiProperty({
    type: String,
    maxLength: 200,
    example: "ana.torres@example.com",
    description:
      "Trimmed and lower-cased. Stored as the e-mail of the person. Unique among people.",
  })
  @Transform(trimLowerToNull)
  @IsEmail()
  @MaxLength(200)
  personalEmail!: string;

  @ApiProperty({
    type: String,
    format: "date",
    example: "1999-07-22",
    description: "YYYY-MM-DD, between 1900-01-01 and today (America/Sao_Paulo).",
  })
  @IsBirthDate()
  birthDate!: string;

  @ApiProperty({
    type: String,
    example: "529.982.247-25",
    description: "Digits only after normalization. Visible only to coordination (RNF-14).",
  })
  @Transform(normalizeCpf)
  @IsCpf()
  cpf!: string;

  @ApiProperty({
    type: String,
    example: "(11) 98181-3030",
    description: "Formatting is stripped; stored as 10 to 13 digits (DDD, optional country code).",
  })
  @Transform(normalizePhone)
  @Matches(PHONE_DIGITS, { message: "phone must have 10 to 13 digits" })
  phone!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 200,
    example: "Rua das Acácias, 120, apto 42",
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(200)
  address?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100, example: "São Paulo" })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @ApiPropertyOptional({
    enum: BRAZILIAN_STATES,
    enumName: "BrazilianState",
    nullable: true,
    example: "SP",
    description: "Federative unit (UF). Upper-cased.",
  })
  @IsOptional()
  @Transform(normalizeState)
  @IsIn(BRAZILIAN_STATES)
  state?: string | null;

  @ApiProperty({
    type: String,
    maxLength: 200,
    example: "ana.torres@example.edu",
    description: "Trimmed and lower-cased.",
  })
  @Transform(trimLowerToNull)
  @IsEmail()
  @MaxLength(200)
  institutionalEmail!: string;

  @ApiProperty({ type: String, maxLength: 100, example: "Sistemas de Informação" })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  course!: string;

  @ApiProperty({ type: "integer", minimum: 1, maximum: 20, example: 7 })
  @IsInt()
  @Min(1)
  @Max(20)
  semester!: number;

  @ApiProperty({
    type: String,
    maxLength: 50,
    example: "SI-2024-N",
    description: "Class (turma) at the university.",
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  className!: string;

  @ApiPropertyOptional({
    type: String,
    format: "uuid",
    nullable: true,
    example: "01999a3e-1111-7000-8000-000000000001",
    description:
      "Suggestion of the person; coordination decides on approval. Pick one of `departments` from GET /auth/invites/:token.",
  })
  @IsOptional()
  @IsUUID("all")
  departmentId?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 500,
    example: "https://drive.google.com/file/d/exemplo/view",
    description: "Link to the volunteer term in Drive (RF-011). HTTPS only.",
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsUrl({ protocols: ["https"], require_protocol: true })
  @MaxLength(500)
  volunteerTermUrl?: string | null;
}
