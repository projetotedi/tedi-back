import { applyDecorators, Type } from "@nestjs/common";
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from "@nestjs/swagger";

/**
 * Composes @ApiExtraModels + @ApiOkResponse to document a paginated endpoint.
 *
 * The response schema is:
 *   { data: T[], total: number, page: number, limit: number }
 *
 * Usage:
 *   @ApiOkResponsePaginated(PersonDto)
 */
export function ApiOkResponsePaginated<T>(model: Type<T>): MethodDecorator {
  return applyDecorators(
    ApiExtraModels(model),
    ApiOkResponse({
      schema: {
        type: "object",
        required: ["data", "total", "page", "limit"],
        properties: {
          data: {
            type: "array",
            items: { $ref: getSchemaPath(model) },
          },
          total: { type: "integer", example: 42 },
          page: { type: "integer", example: 1 },
          limit: { type: "integer", example: 20 },
        },
      },
    }),
  );
}
