import { applyDecorators } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { ApiErrorDto } from "@shared/dto/api-error.dto";

/**
 * Applies standard error response documentation for 400, 401, 403, 404 and 500
 * using ApiErrorDto as the response shape.
 */
export function ApiStandardErrors(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiExtraModels(ApiErrorDto),
    ApiBadRequestResponse({ type: ApiErrorDto }),
    ApiUnauthorizedResponse({ type: ApiErrorDto }),
    ApiForbiddenResponse({ type: ApiErrorDto }),
    ApiNotFoundResponse({ type: ApiErrorDto }),
    ApiInternalServerErrorResponse({ type: ApiErrorDto }),
  );
}
