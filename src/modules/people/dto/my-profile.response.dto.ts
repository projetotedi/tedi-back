import { ApiProperty } from "@nestjs/swagger";
import { Role } from "@shared/enums/role.enum";
import { DepartmentResponseDto } from "./department.response.dto";

const WITHOUT_MEMBER_PROFILE =
  "Null for a person without a member profile (e.g. the seeded admin).";

/**
 * "Meu perfil" (GUS-122): the registration of the logged-in person, and nobody else's.
 * Every key is always present: what is not filled in (or does not exist for this person) is
 * `null`, never absent. Person data comes from Person, the member data from MemberProfile.
 *
 * The CPF never comes in full: only `cpfMasked` (RNF-14). The full CPF stays on the
 * coordination route (GET /member-registrations/:id).
 */
export class MyProfileResponseDto {
  // Person

  @ApiProperty({ type: String, example: "Ana Torres" })
  name!: string;

  @ApiProperty({ type: String, nullable: true, example: "a2210001" })
  ra!: string | null;

  @ApiProperty({
    enum: Role,
    enumName: "Role",
    example: Role.MEMBER,
    description: "Access profile.",
  })
  role!: Role;

  @ApiProperty({ type: Boolean, example: true })
  accessEnabled!: boolean;

  @ApiProperty({ type: String, format: "date", nullable: true, example: "1999-07-22" })
  birthDate!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "11981813030",
    description: "Digits only.",
  })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true, example: "ana.torres@example.com" })
  email!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "ana.torres@example.com",
    description: `Personal e-mail of the member registration (the same value as email). ${WITHOUT_MEMBER_PROFILE}`,
  })
  personalEmail!: string | null;

  // Member profile

  @ApiProperty({
    type: String,
    nullable: true,
    example: "Rua das Acácias, 120, apto 42",
    description: WITHOUT_MEMBER_PROFILE,
  })
  address!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "São Paulo",
    description: WITHOUT_MEMBER_PROFILE,
  })
  city!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "SP",
    description: `UF. ${WITHOUT_MEMBER_PROFILE}`,
  })
  state!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "ana.torres@example.edu",
    description: WITHOUT_MEMBER_PROFILE,
  })
  institutionalEmail!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "Sistemas de Informação",
    description: WITHOUT_MEMBER_PROFILE,
  })
  course!: string | null;

  @ApiProperty({ type: "integer", nullable: true, example: 7, description: WITHOUT_MEMBER_PROFILE })
  semester!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "SI-2024-N",
    description: `Class (turma) at the university. ${WITHOUT_MEMBER_PROFILE}`,
  })
  className!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "https://drive.google.com/file/d/exemplo/view",
    description: WITHOUT_MEMBER_PROFILE,
  })
  volunteerTermUrl!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "Monitora de informática",
    description: WITHOUT_MEMBER_PROFILE,
  })
  mainFunction!: string | null;

  @ApiProperty({
    type: () => DepartmentResponseDto,
    nullable: true,
    description: "Null without a member profile or without a department.",
  })
  department!: DepartmentResponseDto | null;

  @ApiProperty({
    type: String,
    format: "date",
    nullable: true,
    example: "2026-10-01",
    description: WITHOUT_MEMBER_PROFILE,
  })
  joinedAt!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "***.***.247-25",
    description: `CPF with only the last five digits visible; the full CPF is never returned (RNF-14). ${WITHOUT_MEMBER_PROFILE}`,
  })
  cpfMasked!: string | null;

  // Access

  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    example: "2026-10-20T13:00:00.000Z",
    description:
      "The login BEFORE the current one (UTC), not the one that opened this session. Null until the person's second login.",
  })
  lastLoginAt!: Date | null;
}
