import { ApiProperty } from "@nestjs/swagger";
import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";

/**
 * One enrollment of the preview on the sheet of the class (GUS-104): who is enrolled and since
 * when. It has no status: the preview only shows active enrollments, and the status of an
 * enrollment is born with the enrollments (GUS-108).
 */
export class ClassEnrollmentPreviewItemResponseDto {
  @ApiProperty({
    type: String,
    format: "uuid",
    example: "01999a3e-7c1b-7000-8000-0000000000f1",
    description: "Id of the enrollment.",
  })
  id!: string;

  @ApiProperty({ type: () => PersonRefDto, description: "The enrolled student." })
  student!: PersonRefDto;

  @ApiProperty({ type: String, format: "date-time", example: "2026-02-20T14:30:00.000Z" })
  enrolledAt!: Date;
}
