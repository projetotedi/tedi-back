import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DataSource, QueryFailedError } from "typeorm";
import { config } from "dotenv";
import { join } from "node:path";
import { PeopleModule } from "../people.module";
import { PeopleService } from "../services/people.service";
import { Person } from "../entities/person.entity";

config();

const dbUrl = process.env.DATABASE_URL;
const dbConnection = dbUrl
  ? { url: dbUrl }
  : {
      host: process.env.DB_HOST ?? "localhost",
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USERNAME ?? "tedi",
      password: process.env.DB_PASSWORD ?? "tedi",
      database: process.env.DB_DATABASE ?? "tedi",
    };

describe("people repository (e2e)", () => {
  let module: TestingModule;
  let service: PeopleService;
  let dataSource: DataSource;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: "postgres",
          ...dbConnection,
          ssl: dbUrl ? { rejectUnauthorized: false } : false,
          entities: [join(__dirname, "..", "entities", "*.entity.{ts,js}")],
          synchronize: false,
          migrationsRun: false,
        }),
        PeopleModule,
      ],
    }).compile();

    service = module.get(PeopleService);
    dataSource = module.get(DataSource);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await dataSource.query(`TRUNCATE TABLE people RESTART IDENTITY CASCADE`);
  });

  describe("schema", () => {
    it("has exactly the 12 expected columns", async () => {
      const rows: Array<{ column_name: string }> = await dataSource.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'people' ORDER BY ordinal_position`,
      );
      const names = rows.map((r) => r.column_name);
      expect(names).toEqual(
        expect.arrayContaining([
          "id",
          "created_at",
          "updated_at",
          "deleted_at",
          "name",
          "email",
          "ra",
          "password_hash",
          "role",
          "access_enabled",
          "must_change_password",
          "is_super_admin",
        ]),
      );
      expect(names).toHaveLength(12);
    });
  });

  describe("id format", () => {
    it("generates a UUID v7 id on save", async () => {
      const person = await service.save({ name: "Alice" });
      expect(person.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe("RA uniqueness", () => {
    it("rejects a duplicate non-null RA with error code 23505", async () => {
      await service.save({ name: "A", ra: "a2210001" });
      await expect(service.save({ name: "B", ra: "a2210001" })).rejects.toMatchObject({
        code: "23505",
      });
    });

    it("accepts two people with null RA", async () => {
      const a = await service.save({ name: "C", ra: null });
      const b = await service.save({ name: "D", ra: null });
      expect(a.id).toBeDefined();
      expect(b.id).toBeDefined();
      expect(a.id).not.toBe(b.id);
    });
  });

  describe("email round-trip", () => {
    it("stores lowercased email and retrieves by lowercase key", async () => {
      await service.save({ name: "Maria", email: "Maria@X.com" });

      const repo = dataSource.getRepository(Person);
      const found = await repo.findOne({ where: { email: "maria@x.com" } });
      expect(found).not.toBeNull();
      expect(found?.email).toBe("maria@x.com");
    });
  });

  describe("soft delete", () => {
    it("hides soft-deleted records from normal find but shows them with withDeleted", async () => {
      const person = await service.save({ name: "Bob" });

      const repo = dataSource.getRepository(Person);
      await repo.softRemove(person);

      const visible = await repo.find();
      expect(visible.find((p) => p.id === person.id)).toBeUndefined();

      const all = await repo.find({ withDeleted: true });
      const found = all.find((p) => p.id === person.id);
      expect(found).toBeDefined();
      expect(found?.deletedAt).not.toBeNull();
    });
  });

  describe("error type", () => {
    it("duplicate RA throws QueryFailedError", async () => {
      await service.save({ name: "E", ra: "b1234567" });
      await expect(service.save({ name: "F", ra: "b1234567" })).rejects.toBeInstanceOf(
        QueryFailedError,
      );
    });
  });
});
