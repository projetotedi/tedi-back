import { ApiProperty } from "@nestjs/swagger";
import { LessonCoverageDto } from "@modules/lessons/dto/lesson-coverage.response.dto";
import { AssignmentRole } from "../enums/assignment-role.enum";
import { AssignmentLessonResponseDto } from "./assignment-lesson.response.dto";

/** A lesson with an open place for the member (`GET /me/open-lessons`). */
export class OpenLessonResponseDto {
  @ApiProperty({ type: () => AssignmentLessonResponseDto })
  lesson!: AssignmentLessonResponseDto;

  @ApiProperty({
    type: () => LessonCoverageDto,
    description:
      "The coverage of the lesson, the same as in the lesson itself (only confirmed assignments count): what draws Professor(a) 0 de 1 · Monitores 2 de 3.",
  })
  coverage!: LessonCoverageDto;

  @ApiProperty({
    enum: AssignmentRole,
    enumName: "AssignmentRole",
    isArray: true,
    example: [AssignmentRole.TEACHER, AssignmentRole.MONITOR],
    description:
      "The roles with an open place, teacher before monitor; never empty. Applying for one of them is not refused with ROLE_FULL at that moment.",
  })
  openRoles!: AssignmentRole[];
}
