import { ApiProperty, ApiPropertyOptional, ApiSchema } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { trimToNull } from "@shared/dto/transforms";
import { AssignmentRole } from "../enums/assignment-role.enum";
import { ASSIGNMENT_NOTE_MAX_LENGTH } from "./assignment-limits";

/**
 * Body of `POST /lessons/:id/applications`: the role the member applies for, and a note for whoever
 * reviews it. The lesson is the one in the URL, and the applicant is always the person of the
 * session: there is no `personId`, `status` or `source`, and the whitelist drops them when sent.
 *
 * What only this body demands is said in the description of the schema, not in the one of `role`:
 * swagger keeps the description of the first property that names an enum as the description of the
 * enum itself (`AssignmentRole`), which the answers share.
 */
@ApiSchema({
  description:
    "The role the member of the session applies for in the lesson of the URL, and an optional note for whoever reviews it. The application is born pending, source application, and the applicant is always the person of the session: personId, status and source are ignored. The role needs an open place: only confirmed assignments take one, so a teacher place is open while the lesson has no confirmed teacher, and a monitor place while the confirmed monitors are below expectedMonitors (null or 0 expect nobody); otherwise 409 ROLE_FULL. A member who already holds a place in the lesson, pending or confirmed, as either role, gets 409 ALREADY_APPLIED.",
})
export class ApplyToLessonDto {
  @ApiProperty({
    enum: AssignmentRole,
    enumName: "AssignmentRole",
    example: AssignmentRole.MONITOR,
    description: "What the member does in the lesson: the teacher gives it and a monitor helps.",
  })
  @IsEnum(AssignmentRole)
  role!: AssignmentRole;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: ASSIGNMENT_NOTE_MAX_LENGTH,
    example: "Posso chegar 15 min antes para ligar os computadores.",
    description:
      "Note for whoever reviews the application. Optional; null or blank means none. Free text: do not record health information or diagnosis (RNF-13).",
  })
  @IsOptional()
  @Transform(trimToNull)
  @MaxLength(ASSIGNMENT_NOTE_MAX_LENGTH)
  @IsString()
  note?: string | null;
}
