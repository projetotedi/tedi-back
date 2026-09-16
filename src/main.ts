import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { isOriginAllowed, parseCorsOrigins } from "@config/cors";
import { setupSwagger } from "@shared/swagger/swagger.util";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const allowedOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) =>
      callback(null, isOriginAllowed(origin, allowedOrigins)),
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  setupSwagger(app);

  const port = Number(process.env.PORT ?? 3000);
  // 0.0.0.0 para o container/plataforma conseguir alcançar o processo.
  await app.listen(port, "0.0.0.0");
}

bootstrap();
