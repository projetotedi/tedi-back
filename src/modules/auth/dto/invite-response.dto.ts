import { ApiProperty } from "@nestjs/swagger";
import { Role } from "@shared/enums/role.enum";
import { DepartmentResponseDto } from "@modules/people/dto/department.response.dto";
import { InviteType } from "../entities/invite.entity";
import { InvitePersonDto } from "./invite-person.dto";

export class InviteResponseDto {
  @ApiProperty({ enum: InviteType, enumName: "InviteType" })
  type!: InviteType;

  @ApiProperty({ enum: Role, enumName: "Role", nullable: true })
  role!: Role | null;

  @ApiProperty({ example: "2026-09-19T12:00:00.000Z" })
  expiresAt!: Date;

  @ApiProperty({
    type: () => InvitePersonDto,
    nullable: true,
    description: "Account owner. Only on password_reset invites; always null on access invites.",
  })
  person!: InvitePersonDto | null;

  @ApiProperty({
    type: () => [DepartmentResponseDto],
    description:
      "Departments the person may pick in the registration form, ordered by name. Always [] for password_reset.",
  })
  departments!: DepartmentResponseDto[];
}
