import { ApiProperty } from "@nestjs/swagger";
import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";
import { AssignmentRole } from "../enums/assignment-role.enum";
import { AssignmentSource } from "../enums/assignment-source.enum";
import { AssignmentStatus } from "../enums/assignment-status.enum";

/**
 * An assignment of a member to a lesson. The answer of the routes that create, confirm and cancel
 * one, and the item of the list of a lesson, so the client has a single type for them.
 */
export class LessonAssignmentResponseDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-0000000000a1" })
  id!: string;

  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01999a3e-7c1b-7000-8000-0000000000f1",
    description: "Id of the lesson the member is assigned to.",
  })
  lessonId!: string;

  @ApiProperty({
    type: () => PersonRefDto,
    nullable: true,
    description: "The member: id and name. Null if the person was removed.",
  })
  person!: PersonRefDto | null;

  @ApiProperty({
    enum: AssignmentRole,
    enumName: "AssignmentRole",
    example: AssignmentRole.MONITOR,
  })
  role!: AssignmentRole;

  @ApiProperty({
    enum: AssignmentStatus,
    enumName: "AssignmentStatus",
    example: AssignmentStatus.CONFIRMED,
    description:
      "pending waits for a decision; confirmed counts in the coverage of the lesson; declined (a refused application) and cancelled are final.",
  })
  status!: AssignmentStatus;

  @ApiProperty({
    enum: AssignmentSource,
    enumName: "AssignmentSource",
    example: AssignmentSource.DIRECT,
    description:
      "direct is made by a coordinator or a director; application is a member who applied.",
  })
  source!: AssignmentSource;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "Cobre a segunda hora da aula.",
    description:
      "Free text (RNF-13). Null when there is none, and null for profiles without assignments.create: only who can manage assignments reads the note.",
  })
  note!: string | null;

  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01999a3e-0000-7000-8000-0000000000aa",
    description: "Id of the person who made the assignment.",
  })
  createdById!: string;

  @ApiProperty({
    type: String,
    format: "uuid",
    nullable: true,
    example: "01999a3e-0000-7000-8000-0000000000aa",
    description:
      "Id of the person who confirmed the assignment, or who made it already confirmed. Set exactly when reviewedAt is, and kept if the assignment is cancelled later.",
  })
  reviewedById!: string | null;

  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    example: "2026-03-09T12:00:00.000Z",
    description: "When it was confirmed. Always set for a confirmed assignment.",
  })
  reviewedAt!: Date | null;

  @ApiProperty({
    type: String,
    format: "uuid",
    nullable: true,
    example: null,
    description: "Id of the person who cancelled the assignment.",
  })
  cancelledById!: string | null;

  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    example: null,
    description: "When it was cancelled. Set exactly when the status is cancelled.",
  })
  cancelledAt!: Date | null;

  @ApiProperty({ type: String, format: "date-time", example: "2026-03-09T12:00:00.000Z" })
  createdAt!: Date;

  @ApiProperty({ type: String, format: "date-time", example: "2026-03-09T12:00:00.000Z" })
  updatedAt!: Date;
}
