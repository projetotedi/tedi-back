import { ApiProperty } from "@nestjs/swagger";
import { AssignmentRole } from "../enums/assignment-role.enum";
import { AssignmentSource } from "../enums/assignment-source.enum";
import { AssignmentStatus } from "../enums/assignment-status.enum";
import { AssignmentLessonRefDto } from "./assignment-lesson-ref.response.dto";

/** One assignment in the list of a member (`GET /members/:id/assignments`): the lesson and what the member does in it. */
export class MemberAssignmentResponseDto {
  @ApiProperty({ type: String, format: "uuid", example: "01999a3e-7c1b-7000-8000-0000000000a1" })
  id!: string;

  @ApiProperty({ type: () => AssignmentLessonRefDto })
  lesson!: AssignmentLessonRefDto;

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
    description: "Every status is listed, the cancelled and the declined ones too.",
  })
  status!: AssignmentStatus;

  @ApiProperty({
    enum: AssignmentSource,
    enumName: "AssignmentSource",
    example: AssignmentSource.DIRECT,
  })
  source!: AssignmentSource;

  @ApiProperty({ type: String, format: "date-time", example: "2026-03-09T12:00:00.000Z" })
  createdAt!: Date;
}
