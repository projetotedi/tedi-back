import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from "@nestjs/swagger";

/**
 * Path where the Swagger UI is served.
 */
export const SWAGGER_DOCS_PATH = "api/docs";

/**
 * Builds the OpenAPI config (DocumentBuilder result).
 *
 * Centralised here so `OpenApiExportModule` can reuse the same config
 * without pulling in the full application.
 */
export function buildOpenApiConfig(): ReturnType<DocumentBuilder["build"]> {
  return new DocumentBuilder()
    .setTitle("TEDI API")
    .setDescription("Documentação da API do projeto TEDI")
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
}

/**
 * Generates the OpenAPI document from the running application.
 *
 * Note on `operationIdFactory`:
 *   `(_controller, method) => method` produces the plain method name as the
 *   `operationId` (e.g. `check` instead of `HealthController_check`).
 *   Risk: if two controllers share a method name (e.g. both have `create`),
 *   Orval will collide. Mitigate in GUS-78 by prefixing per tag when a
 *   duplicate is detected.
 */
export function buildDocument(app: INestApplication): OpenAPIObject {
  const config = buildOpenApiConfig();
  return SwaggerModule.createDocument(app, config, {
    operationIdFactory: (_controller: string, method: string) => method,
  });
}

/**
 * Mounts the Swagger UI at `SWAGGER_DOCS_PATH` using `buildDocument`.
 */
export function setupSwagger(app: INestApplication): void {
  const document = buildDocument(app);
  SwaggerModule.setup(SWAGGER_DOCS_PATH, app, document);
}
