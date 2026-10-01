import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { flattenValidationErrors } from "./http-exception.filter";

/**
 * Builds the global ValidationPipe with the exceptionFactory that produces
 * the VALIDATION_FAILED payload consumed by HttpExceptionFilter.
 *
 * Extracted here so both main.ts and e2e tests can use the same configuration.
 */
export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    exceptionFactory: (errors) =>
      new BadRequestException({
        error: "VALIDATION_FAILED",
        rawErrors: flattenValidationErrors(errors),
      }),
  });
}
