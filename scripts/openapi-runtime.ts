/**
 * Boots a minimal NestJS application (no HTTP server, no database) and
 * produces the serialised OpenAPI document as a string.
 *
 * Uses `OpenApiExportModule` which stubs all external dependencies, so this
 * function works without any environment variables or Postgres connection.
 */
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { OpenApiExportModule } from "@shared/swagger/openapi-export.module";
import { buildDocument } from "@shared/swagger/swagger.util";
import { serializeOpenApi } from "./openapi-serialize";

/**
 * Creates the NestJS app from `OpenApiExportModule`, generates the OpenAPI
 * document, serialises it and closes the app.
 *
 * @returns The serialised JSON string (ends with `\n`).
 */
export async function computeOpenApiJson(): Promise<string> {
  const app = await NestFactory.create(OpenApiExportModule, { logger: false });

  try {
    const doc = buildDocument(app);
    return serializeOpenApi(doc);
  } finally {
    await app.close();
  }
}
