import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import { DataSource } from "typeorm";
import { HealthResponseDto } from "./health.response.dto";

/**
 * Usado pelo health check da plataforma (Render, Docker) e para saber se o banco responde.
 * Não exige autenticação e não expõe nada além de status.
 */
@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({ description: "Banco de dados indisponível" })
  async check(): Promise<HealthResponseDto> {
    const base = {
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };

    try {
      await this.dataSource.query("SELECT 1");
    } catch {
      throw new ServiceUnavailableException({ status: "error", database: "down", ...base });
    }

    return { status: "ok", database: "up", ...base };
  }
}
