import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEnum, IsInt, IsOptional, Max, Min } from "class-validator";
import { ClassStatus } from "../enums/class-status.enum";

/** Query parameters for GET /courses/:id/classes. */
export class ListCourseClassesQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value !== undefined ? Number(value) : undefined))
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value !== undefined ? Number(value) : undefined))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    enum: ClassStatus,
    enumName: "ClassStatus",
    description: "Only the classes with this status. One value. Omit for every status.",
  })
  @IsOptional()
  @IsEnum(ClassStatus)
  status?: ClassStatus;
}
