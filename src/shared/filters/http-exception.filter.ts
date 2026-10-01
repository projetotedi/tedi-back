import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
import { ValidationError } from "class-validator";
import type { ApiErrorDto, ApiFieldErrorDto } from "@shared/dto/api-error.dto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MESSAGES: Record<number, string> = {
  400: "Bad request.",
  401: "Unauthorized.",
  403: "Forbidden.",
  404: "Resource not found.",
  409: "Conflict.",
  422: "Unprocessable entity.",
  429: "Too many requests.",
  500: "Internal server error.",
};

const DEFAULT_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "UNPROCESSABLE_ENTITY",
  429: "TOO_MANY_REQUESTS",
  500: "INTERNAL_SERVER_ERROR",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Represents a single flattened validation error with dot-notation property path.
 */
export interface FlatValidationError {
  field: string;
  message: string;
}

/**
 * Recursively flattens class-validator ValidationError trees into a flat list
 * with dot-notation property paths (e.g. "user.address.zip").
 */
export function flattenValidationErrors(
  errors: ValidationError[],
  prefix = "",
): FlatValidationError[] {
  const result: FlatValidationError[] = [];

  for (const error of errors) {
    const field = prefix ? `${prefix}.${error.property}` : error.property;

    if (error.constraints) {
      const message = Object.values(error.constraints)[0] ?? "invalid value";
      result.push({ field, message });
    }

    if (error.children && error.children.length > 0) {
      result.push(...flattenValidationErrors(error.children, field));
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Validation payload shape (from exceptionFactory in validation-pipe.factory.ts)
// ---------------------------------------------------------------------------

interface ValidationFailedPayload {
  error: "VALIDATION_FAILED";
  rawErrors: FlatValidationError[];
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let body: ApiErrorDto;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse() as Record<string, unknown>;

      // Router-generated NotFoundException ("Cannot GET /x") → normalise to NOT_FOUND
      if (
        status === HttpStatus.NOT_FOUND &&
        typeof payload === "object" &&
        typeof payload["message"] === "string" &&
        payload["message"].startsWith("Cannot ")
      ) {
        body = {
          statusCode: HttpStatus.NOT_FOUND,
          message: DEFAULT_MESSAGES[HttpStatus.NOT_FOUND] ?? "Resource not found.",
          error: "NOT_FOUND",
        };
      }
      // Validation pipe errors from buildValidationPipe exceptionFactory
      else if (
        typeof payload === "object" &&
        payload["error"] === "VALIDATION_FAILED" &&
        Array.isArray(payload["rawErrors"])
      ) {
        const validationPayload = payload as unknown as ValidationFailedPayload;
        const details: ApiFieldErrorDto[] = validationPayload.rawErrors.map((e) => ({
          field: e.field,
          message: e.message,
        }));

        body = {
          statusCode: status,
          message: DEFAULT_MESSAGES[status] ?? "Bad request.",
          error: "VALIDATION_FAILED",
          details,
        };
      }
      // Other HttpExceptions — use payload fields when present
      else {
        const message =
          typeof payload["message"] === "string"
            ? payload["message"]
            : (DEFAULT_MESSAGES[status] ?? "An error occurred.");

        const errorCode =
          typeof payload["error"] === "string"
            ? payload["error"]
            : (DEFAULT_CODES[status] ?? "ERROR");

        body = {
          statusCode: status,
          message,
          error: errorCode,
        };

        if (Array.isArray(payload["details"])) {
          body.details = payload["details"] as ApiFieldErrorDto[];
        }
      }
    } else {
      // Unexpected (non-HTTP) error — log with stack, respond with generic 500
      const err = exception as Error;
      this.logger.error(err.message ?? "Unexpected error", err.stack);

      body = {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: DEFAULT_MESSAGES[HttpStatus.INTERNAL_SERVER_ERROR] ?? "Internal server error.",
        error: "INTERNAL_SERVER_ERROR",
      };
    }

    response.status(body.statusCode).json(body);
  }
}
