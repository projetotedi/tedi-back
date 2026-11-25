import { ApiProperty } from "@nestjs/swagger";
import { PersonRefDto } from "@modules/people/dto/person-ref.response.dto";
import {
  ABSENCE_JUSTIFICATION_REASON_DESCRIPTION,
  AbsenceJustificationReason,
} from "../enums/absence-justification-reason.enum";

/** The justification of an absence of a student: why, the note, who and when. It may be health data. */
export class AbsenceJustificationResponseDto {
  @ApiProperty({
    enum: AbsenceJustificationReason,
    enumName: "AbsenceJustificationReason",
    example: AbsenceJustificationReason.HEALTH,
    description: ABSENCE_JUSTIFICATION_REASON_DESCRIPTION,
  })
  reason!: AbsenceJustificationReason;

  @ApiProperty({
    type: String,
    nullable: true,
    example: "Consulta médica marcada.",
    description: "Free text of the justification. Null when it has none.",
  })
  note!: string | null;

  @ApiProperty({
    type: () => PersonRefDto,
    nullable: true,
    description: "Who justified the absence the last time. Null when the person was removed.",
  })
  justifiedBy!: PersonRefDto | null;

  @ApiProperty({
    type: String,
    format: "date-time",
    example: "2026-03-10T14:20:00.000Z",
    description: "When the absence was justified the last time.",
  })
  justifiedAt!: Date;
}
