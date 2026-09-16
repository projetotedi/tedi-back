import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

export const SWAGGER_DOCS_PATH = "api/docs";

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle("TEDI API")
    .setDescription("Documentação da API do projeto TEDI")
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(SWAGGER_DOCS_PATH, app, document);
}
