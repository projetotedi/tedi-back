import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { ARCHIVE_REASON_MAX_LENGTH } from "@shared/entities/archivable.columns";
import { trimToNull } from "./transforms";

/**
 * Common body of every `PATCH /<resource>/:id/archive` (RN-27).
 * One schema for students, lesson plans, courses and classes, so the Orval client
 * has a single ArchiveDto type.
 */
export class ArchiveDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: ARCHIVE_REASON_MAX_LENGTH,
    example: "Mudou de cidade.",
    description: "Optional reason. Do not record health information or diagnosis (RNF-13).",
  })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(ARCHIVE_REASON_MAX_LENGTH)
  reason?: string | null;
}
