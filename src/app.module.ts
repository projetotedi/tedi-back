import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { dataSourceOptions } from "@database/data-source";
import { HealthController } from "@shared/health/health.controller";
import { I18nModule } from "@shared/i18n";
import { PeopleModule } from "@modules/people/people.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(dataSourceOptions),
    I18nModule,
    PeopleModule,
    // Módulos de domínio entram aqui, um por área (ver docs/ARCHITECTURE.md):
    // AuthModule, TurmasModule, AulasModule, ...
  ],
  controllers: [HealthController],
})
export class AppModule {}
