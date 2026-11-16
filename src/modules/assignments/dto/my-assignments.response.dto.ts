import { ApiProperty } from "@nestjs/swagger";
import { AssignmentRole } from "../enums/assignment-role.enum";
import { AssignmentSource } from "../enums/assignment-source.enum";
import { AssignmentStatus } from "../enums/assignment-status.enum";
import { AssignmentLessonResponseDto } from "./assignment-lesson.response.dto";

/** The four totals of the top of "Minhas aulas". Every key is always there, zero included. */
export class MyAssignmentsTotalsDto {
  @ApiProperty({
    type: "integer",
    example: 3,
    description:
      "Lessons of the period where the member is pending or confirmed (Próximas aulas): always confirmed plus pending. It counts the whole period, including days before today when `from` is in the past; without `from` the period starts today.",
  })
  upcoming!: number;

  @ApiProperty({ type: "integer", example: 2, description: "Items with status confirmed." })
  confirmed!: number;

  @ApiProperty({
    type: "integer",
    example: 1,
    description:
      "Items with status pending (Aguardando confirmação): an application or a direct assignment still waiting.",
  })
  pending!: number;

  @ApiProperty({
    type: "integer",
    example: 3,
    description:
      "How many lessons of the period have an open place for the member (Aulas com vaga para você): the number of items GET /me/open-lessons answers for the same period.",
  })
  openLessons!: number;
}

/** One lesson of "Minhas aulas": the lesson and the latest assignment of the member in it. */
export class MyAssignmentResponseDto {
  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01999a3e-7c1b-7000-8000-0000000000a1",
    description: "Id of the assignment (or application) of the member.",
  })
  id!: string;

  @ApiProperty({ type: () => AssignmentLessonResponseDto })
  lesson!: AssignmentLessonResponseDto;

  @ApiProperty({
    enum: AssignmentRole,
    enumName: "AssignmentRole",
    example: AssignmentRole.MONITOR,
  })
  role!: AssignmentRole;

  @ApiProperty({
    enum: AssignmentStatus,
    enumName: "AssignmentStatus",
    example: AssignmentStatus.PENDING,
    description:
      "The latest status of the member in the lesson: the active one (pending or confirmed) when there is one, else the latest declined or cancelled.",
  })
  status!: AssignmentStatus;

  @ApiProperty({
    enum: AssignmentSource,
    enumName: "AssignmentSource",
    example: AssignmentSource.APPLICATION,
  })
  source!: AssignmentSource;
}

/** "Minhas aulas" (`GET /me/assignments`): the period it covers, the totals and the lessons. */
export class MyAssignmentsResponseDto {
  @ApiProperty({
    type: String,
    format: "date",
    example: "2026-03-09",
    description: "First day of the period, as resolved (today when it was not asked).",
  })
  from!: string;

  @ApiProperty({
    type: String,
    format: "date",
    example: "2026-04-05",
    description: "Last day of the period, as resolved (27 days after from when it was not asked).",
  })
  to!: string;

  @ApiProperty({ type: () => MyAssignmentsTotalsDto })
  totals!: MyAssignmentsTotalsDto;

  @ApiProperty({
    type: () => MyAssignmentResponseDto,
    isArray: true,
    description:
      "One item per lesson of the period where the member has an assignment, soonest first (by date, start time and id). Not paginated: the period holds at most 42 days.",
  })
  items!: MyAssignmentResponseDto[];
}
