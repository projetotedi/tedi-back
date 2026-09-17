import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class ApiFieldErrorDto {
  @ApiProperty({ example: "email", description: "Field name in dot-notation" })
  field!: string;

  @ApiProperty({ example: "email must be an email" })
  message!: string;
}

export class ApiErrorDto {
  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({ example: "Bad request." })
  message!: string;

  @ApiProperty({ example: "BAD_REQUEST" })
  error!: string;

  @ApiPropertyOptional({ type: [ApiFieldErrorDto] })
  details?: ApiFieldErrorDto[];
}
