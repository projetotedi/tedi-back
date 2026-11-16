import { ApiProperty, ApiPropertyOptional, ApiSchema } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";
import { trimToNull } from "@shared/dto/transforms";
import { AssignmentRole } from "../enums/assignment-role.enum";
import { AssignmentStatus, CREATABLE_ASSIGNMENT_STATUSES } from "../enums/assignment-status.enum";
import { ASSIGNMENT_NOTE_MAX_LENGTH } from "./assignment-limits";

/**
 * Body of `POST /lessons/:id/assignments`: who is assigned to the lesson, as what, and whether it
 * is already confirmed. The lesson is the one in the URL.
 *
 * There is no `source` on purpose, and the whitelist drops it when sent: an assignment made here is
 * always `direct`. `application` is the candidature of a member (GUS-160).
 *
 * What only this body demands (status takes two of the four values) is said in the description of
 * the schema, not in the one of the property: `role` and `status` point to the enums that the
 * answers share (`AssignmentRole`, `AssignmentStatus`), and swagger keeps the description of the
 * first property that names an enum as the description of the enum itself.
 */
@ApiSchema({
  description:
    "Who is assigned to the lesson of the URL, as what, and whether it is already confirmed. status takes only pending or confirmed: declined and cancelled come out of a decision about an assignment that exists, so they are rejected with 400 VALIDATION_FAILED. A lesson has at most one confirmed teacher: a teacher asked confirmed in a lesson that already has one is 409 LESSON_TEACHER_TAKEN. There is no source: an assignment made here is always direct (the candidature of a member is another route).",
})
export class CreateAssignmentDto {
  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01999a3e-0000-7000-8000-0000000000b1",
    description:
      "Id of the member to assign. It must be an active member: an id that is not a member is 400 MEMBER_NOT_FOUND, and a member without access (inactive or with the registration still pending) is 409 MEMBER_INACTIVE. A member holds one place per lesson: if she already has an active assignment in it, as the same role or as the other one, it is 409 DUPLICATE_ROLE_IN_LESSON.",
  })
  @IsUUID("all")
  personId!: string;

  @ApiProperty({
    enum: AssignmentRole,
    enumName: "AssignmentRole",
    example: AssignmentRole.MONITOR,
    description: "What the member does in the lesson: the teacher gives it and a monitor helps.",
  })
  @IsEnum(AssignmentRole)
  role!: AssignmentRole;

  @ApiProperty({
    enum: AssignmentStatus,
    enumName: "AssignmentStatus",
    example: AssignmentStatus.CONFIRMED,
    description:
      "Where the assignment stands: pending waits for a decision, confirmed puts the member in the lesson (and records who confirmed it and when), declined (a refused application) and cancelled are final.",
  })
  @IsIn(CREATABLE_ASSIGNMENT_STATUSES)
  status!: AssignmentStatus;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: ASSIGNMENT_NOTE_MAX_LENGTH,
    example: "Cobre a segunda hora da aula.",
    description:
      "Note about the assignment. Optional; null or blank means none. Free text: do not record health information or diagnosis (RNF-13).",
  })
  @IsOptional()
  @Transform(trimToNull)
  @MaxLength(ASSIGNMENT_NOTE_MAX_LENGTH)
  @IsString()
  note?: string | null;
}
