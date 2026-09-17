// AuthModule (dentro do AppModule) chama ConfigService.getOrThrow('JWT_SECRET') no boot.
// Este teste sobe o AppModule inteiro, então precisa da env; fixamos aqui para o spec
// funcionar sem depender de .env local — o CI também exporta a mesma env.
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "app-e2e-secret-not-for-production";

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../app.module";

/**
 * Teste de fumaça da aplicação inteira: única exceção à regra "todo teste mora no módulo",
 * porque o objeto aqui é a montagem do AppModule (imports, providers globais), não um módulo.
 * Pega módulo esquecido no AppModule e configuração quebrada antes de qualquer teste por módulo.
 */
describe("AppModule", () => {
  let app: INestApplication | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("sobe e /health responde com o banco acessível", async () => {
    const res = await request(app!.getHttpServer()).get("/health").expect(200);
    expect(res.body).toMatchObject({ status: "ok", database: "up" });
  });
});
