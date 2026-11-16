import { ApiProperty } from "@nestjs/swagger";
import { LessonCoverageDto } from "@modules/lessons/dto/lesson-coverage.response.dto";
import { AssignmentLessonResponseDto } from "./assignment-lesson.response.dto";
import { LessonAssignmentResponseDto } from "./lesson-assignment.response.dto";

/** The pending applications of one lesson, with the lesson and its coverage. */
export class PendingApplicationGroupResponseDto {
  @ApiProperty({ type: () => AssignmentLessonResponseDto })
  lesson!: AssignmentLessonResponseDto;

  @ApiProperty({
    type: () => LessonCoverageDto,
    description:
      "The coverage of the lesson, the same as in the lesson itself: only confirmed assignments count, so the pending applications do not raise it.",
  })
  coverage!: LessonCoverageDto;

  @ApiProperty({
    type: () => LessonAssignmentResponseDto,
    isArray: true,
    description:
      "The pending applications of the lesson, the oldest first: each with the member, the role, the note and createdAt (when it was sent).",
  })
  applications!: LessonAssignmentResponseDto[];
}

/** The queue of the pending applications (`GET /applications`), grouped by lesson. */
export class PendingApplicationsResponseDto {
  @ApiProperty({
    type: "integer",
    example: 3,
    description:
      "How many applications are listed, whatever the lessons they are in: the N of the button Candidaturas pendentes (N).",
  })
  total!: number;

  @ApiProperty({
    type: () => PendingApplicationGroupResponseDto,
    isArray: true,
    description:
      "One group per lesson with a pending application, the soonest lesson first (by date, start time and id); a past or cancelled lesson is listed too, so its applications can be declined.",
  })
  lessons!: PendingApplicationGroupResponseDto[];
}
