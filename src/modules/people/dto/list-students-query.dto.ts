import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { AccessibilityNeed } from "../enums/accessibility-need.enum";
import { StudentListSort } from "../enums/student-list-sort.enum";

/** The value of `accessibilityNeed` that means "some need": every category but `none`. */
export const ANY_ACCESSIBILITY_NEED = "any";

export type AccessibilityNeedFilter = AccessibilityNeed | typeof ANY_ACCESSIBILITY_NEED;

const ACCESSIBILITY_NEED_FILTERS: readonly string[] = [
  ...Object.values(AccessibilityNeed),
  ANY_ACCESSIBILITY_NEED,
];

/** Most ids `ids` takes: the page limit of the project. */
export const STUDENT_LIST_MAX_IDS = 100;

const toNumber = ({ value }: { value: unknown }): unknown =>
  value !== undefined ? Number(value) : undefined;

const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
};

/**
 * The values of a list parameter, from the comma separated text or from the repeated parameter
 * (`ids=a&ids=b`), trimmed, the empty ones dropped and each one once. Anything that is not text is
 * returned as it came, for the validators to reject.
 */
const toList = ({ value }: { value: unknown }): unknown => {
  const parts: unknown[] = Array.isArray(value) ? value : [value];
  if (!parts.every((part): part is string => typeof part === "string")) return value;

  return [
    ...new Set(
      parts
        .flatMap((part) => part.split(","))
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  ];
};

/**
 * Query parameters of GET /students (GUS-106). The filters combine with AND.
 *
 * `accessibilityNeed` and `ids` are documented as one comma separated text, not as an array: the
 * client that Orval generates writes an array as a repeated parameter, and one text is what the
 * screen sends. The server takes both.
 */
export class ListStudentsQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    example: "maria",
    maxLength: 100,
    description:
      "Part of the name or of the e-mail, ignoring case and accents; when the term has only digits and the characters space ( ) - . +, also the digits of the phone, whatever mask it was stored with.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    type: String,
    example: "visual,hearing",
    description:
      "One or more categories, comma separated (none, visual, hearing, motor, cognitive, other), or any: every category but none. The students of any of them. Omitted or empty lists every category.",
  })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(ACCESSIBILITY_NEED_FILTERS.length)
  @IsIn(ACCESSIBILITY_NEED_FILTERS, { each: true })
  accessibilityNeed?: AccessibilityNeedFilter[];

  @ApiPropertyOptional({
    type: String,
    example: "01999a3e-7c1b-7000-8000-000000000001,01999a3e-7c1b-7000-8000-000000000002",
    description: `Only these students (person ids), comma separated: from 1 to ${STUDENT_LIST_MAX_IDS} ids, else 400 VALIDATION_FAILED (an empty ids too). Paginated and ordered like the rest of the list; an id that is not a student, an archived one (without archived=true) or a removed one is left out.`,
  })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(STUDENT_LIST_MAX_IDS)
  @IsUUID("all", { each: true })
  ids?: string[];

  @ApiPropertyOptional({
    example: false,
    description:
      "true lists only the archived students. Omitted (or false) lists only the students that are not archived (RN-27).",
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  archived?: boolean;

  @ApiPropertyOptional({
    enum: StudentListSort,
    enumName: "StudentListSort",
    default: StudentListSort.NAME,
    description: "name is alphabetical; createdAt puts the student registered last first.",
  })
  @IsOptional()
  @IsEnum(StudentListSort)
  sort?: StudentListSort;
}
