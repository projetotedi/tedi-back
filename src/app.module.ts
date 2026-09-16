import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { dataSourceOptions } from "@database/data-source";
import { HealthController } from "@shared/health/health.controller";
import { I18nModule } from "@shared/i18n";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(dataSourceOptions),
    I18nModule,
    // Módulos de domínio entram aqui, um por área (ver docs/ARCHITECTURE.md):
    // AuthModule, PessoasModule, TurmasModule, AulasModule, ...
  ],
  controllers: [HealthController],
})
export class AppModule {}
