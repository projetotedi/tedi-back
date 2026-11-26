import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import { AssignmentStatus } from "../enums/assignment-status.enum";

/**
 * Query of `GET /applications`. `status` only takes `pending`, the default: the route is the queue
 * of the applications that wait for a decision. Taking another status later is additive.
 */
export class ListApplicationsQueryDto {
  // No enumName on purpose: a one-value enum named apart would collide with AssignmentStatus.
  @ApiPropertyOptional({
    enum: [AssignmentStatus.PENDING],
    default: AssignmentStatus.PENDING,
    description:
      "Which applications are listed. Only pending, the default; any other value is 400 VALIDATION_FAILED.",
  })
  @IsOptional()
  @IsIn([AssignmentStatus.PENDING])
  status?: AssignmentStatus.PENDING;
}
