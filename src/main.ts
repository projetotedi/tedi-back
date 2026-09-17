import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { isOriginAllowed, parseCorsOrigins } from "@config/cors";
import { setupSwagger } from "@shared/swagger/swagger.util";
import { buildValidationPipe } from "@shared/filters/validation-pipe.factory";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const allowedOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) =>
      callback(null, isOriginAllowed(origin, allowedOrigins)),
    credentials: true,
  });

  app.use(cookieParser());
  app.useGlobalPipes(buildValidationPipe());
  setupSwagger(app);

  const port = Number(process.env.PORT ?? 3000);
  // 0.0.0.0 para o container/plataforma conseguir alcançar o processo.
  await app.listen(port, "0.0.0.0");
}

bootstrap();
