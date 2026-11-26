import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

/** Query parameters of GET /lesson-plans/contents (GUS-95). */
export class ListLessonPlanContentsQueryDto {
  @ApiPropertyOptional({
    example: "jan",
    maxLength: 100,
    description: "Only the contents that contain this text, ignoring case and accents.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
