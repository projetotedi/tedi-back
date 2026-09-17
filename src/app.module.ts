import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { APP_FILTER } from "@nestjs/core";
import { dataSourceOptions } from "@database/data-source";
import { HealthController } from "@shared/health/health.controller";
import { HttpExceptionFilter } from "@shared/filters/http-exception.filter";
import { AuthModule } from "@modules/auth/auth.module";
import { PeopleModule } from "@modules/people/people.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(dataSourceOptions),
    AuthModule,
    PeopleModule,
    // Módulos de domínio entram aqui, um por área (ver docs/ARCHITECTURE.md):
    // TurmasModule, AulasModule, ...
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
export class AppModule {}
