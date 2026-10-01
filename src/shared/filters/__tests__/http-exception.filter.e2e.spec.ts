import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { APP_FILTER } from "@nestjs/core";
import request from "supertest";
import { HttpExceptionFilter } from "../http-exception.filter";
import { buildValidationPipe } from "../validation-pipe.factory";
import { ErrorDemoModule } from "./test-support/error-demo.module";

/**
 * E2E tests for HttpExceptionFilter.
 * Runs without TypeORM — only ErrorDemoModule is imported.
 */
describe("HttpExceptionFilter (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ErrorDemoModule],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // -------------------------------------------------------------------------
  // Case 1 / CA1: Validation error → 400 with details in English
  // -------------------------------------------------------------------------
  describe("Case 1 — validation error", () => {
    it("POST /error-demo/validate with invalid email → 400 with VALIDATION_FAILED details", async () => {
      const res = await request(app.getHttpServer())
        .post("/error-demo/validate")
        .send({ email: "x" })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.error).toBe("VALIDATION_FAILED");
      expect(Array.isArray(res.body.details)).toBe(true);
      expect(res.body.details[0]).toMatchObject({
        field: "email",
        message: "email must be an email",
      });
    });
  });

  // -------------------------------------------------------------------------
  // Case 2 / CA2: Unknown route → 404 NOT_FOUND
  // -------------------------------------------------------------------------
  describe("Case 2 — unknown route", () => {
    it("GET /does-not-exist → 404 with NOT_FOUND error code", async () => {
      const res = await request(app.getHttpServer()).get("/does-not-exist").expect(404);

      expect(res.body).toMatchObject({
        statusCode: 404,
        message: "Resource not found.",
        error: "NOT_FOUND",
      });
    });
  });

  // -------------------------------------------------------------------------
  // Case 3 / CA3: Unhandled error → 500 without leaking message
  // -------------------------------------------------------------------------
  describe("Case 3 — unhandled error", () => {
    it("GET /error-demo/boom → 500 without 'secret' in body", async () => {
      const res = await request(app.getHttpServer()).get("/error-demo/boom").expect(500);

      expect(res.body.statusCode).toBe(500);
      expect(res.body.message).toBe("Internal server error.");
      expect(res.body.error).toBe("INTERNAL_SERVER_ERROR");
      expect(JSON.stringify(res.body)).not.toContain("secret");
    });
  });
});
