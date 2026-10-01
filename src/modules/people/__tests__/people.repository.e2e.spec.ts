import "reflect-metadata";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DataSource, EntityTarget, QueryFailedError } from "typeorm";
import { config } from "dotenv";
import { join } from "node:path";
import { PeopleModule } from "../people.module";
import { PeopleService } from "../services/people.service";
import { StudentsService } from "../services/students.service";
import { Person } from "../entities/person.entity";
import { StudentProfile } from "../entities/student-profile.entity";
import { AccessibilityNeed } from "../enums/accessibility-need.enum";

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
  let studentsService: StudentsService;
  let dataSource: DataSource;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        // StudentsService (provided by PeopleModule) injects EventEmitter2.
        EventEmitterModule.forRoot(),
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
    studentsService = module.get(StudentsService);
    dataSource = module.get(DataSource);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await dataSource.query(`TRUNCATE TABLE student_profiles, people RESTART IDENTITY CASCADE`);
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
          "birth_date",
          "phone",
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

  describe("schema vs entities", () => {
    // Postgres udt_name for each TypeORM column type used by the entities.
    const UDT_NAME: Record<string, string> = {
      uuid: "uuid",
      varchar: "varchar",
      text: "text",
      date: "date",
      timestamptz: "timestamptz",
      boolean: "bool",
    };

    interface ColumnShape {
      name: string;
      type: string;
      length: number | null;
      nullable: boolean;
    }

    function byName(a: ColumnShape, b: ColumnShape): number {
      return a.name.localeCompare(b.name);
    }

    /** What the entity declares. TypeORM keeps `length` as a string ("200") and "" when unset. */
    function declaredColumns(entity: EntityTarget<unknown>): ColumnShape[] {
      return dataSource
        .getMetadata(entity)
        .columns.map((column) => ({
          name: column.databaseName,
          type: column.type === "enum" ? (column.enumName ?? "") : UDT_NAME[String(column.type)],
          length: column.length ? Number(column.length) : null,
          nullable: column.isNullable,
        }))
        .sort(byName);
    }

    /** What the migrations created. is_nullable is YES or NO and the length may be null. */
    async function actualColumns(table: string): Promise<ColumnShape[]> {
      const rows: Array<{
        column_name: string;
        udt_name: string;
        character_maximum_length: number | null;
        is_nullable: "YES" | "NO";
      }> = await dataSource.query(
        `SELECT column_name, udt_name, character_maximum_length, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1`,
        [table],
      );
      return rows
        .map((row) => ({
          name: row.column_name,
          type: row.udt_name,
          length: row.character_maximum_length ?? null,
          nullable: row.is_nullable === "YES",
        }))
        .sort(byName);
    }

    it("matches the entity metadata column by column (name, type, length, nullability)", async () => {
      expect(await actualColumns("people")).toEqual(declaredColumns(Person));
      expect(await actualColumns("student_profiles")).toEqual(declaredColumns(StudentProfile));
    });

    it("has the unique index uq_student_profiles_person_id", async () => {
      const rows: Array<{ indexdef: string }> = await dataSource.query(
        `SELECT indexdef FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'student_profiles'
            AND indexname = 'uq_student_profiles_person_id'`,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].indexdef).toContain("CREATE UNIQUE INDEX");
      expect(rows[0].indexdef).toContain("(person_id)");
    });

    it("has the three named foreign keys to people", async () => {
      const rows: Array<Record<string, string>> = await dataSource.query(
        `SELECT tc.constraint_name, kcu.column_name, ccu.table_name AS referenced_table,
                ccu.column_name AS referenced_column, rc.delete_rule, rc.update_rule
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
           JOIN information_schema.constraint_column_usage ccu
             ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
           JOIN information_schema.referential_constraints rc
             ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
            AND tc.table_name = 'student_profiles'
          ORDER BY tc.constraint_name`,
      );

      const declared = dataSource
        .getMetadata(StudentProfile)
        .foreignKeys.map((foreignKey) => ({
          constraint_name: foreignKey.name,
          column_name: foreignKey.columnNames[0],
          referenced_table: foreignKey.referencedTablePath,
          referenced_column: foreignKey.referencedColumnNames[0],
          delete_rule: foreignKey.onDelete,
          update_rule: foreignKey.onUpdate,
        }))
        .sort((a, b) => a.constraint_name.localeCompare(b.constraint_name));

      expect(declared.map((foreignKey) => foreignKey.constraint_name)).toEqual([
        "fk_student_profiles_archived_by_id",
        "fk_student_profiles_created_by_id",
        "fk_student_profiles_person_id",
      ]);
      expect(rows).toEqual(declared);
    });

    it("defaults accessibility_need to none", async () => {
      const person = await service.save({ name: "Maria" });

      await dataSource.query(
        `INSERT INTO student_profiles (id, person_id, created_by_id)
         VALUES (gen_random_uuid(), $1, $1)`,
        [person.id],
      );

      const rows: Array<{ accessibility_need: string }> = await dataSource.query(
        `SELECT accessibility_need FROM student_profiles WHERE person_id = $1`,
        [person.id],
      );
      expect(rows).toEqual([{ accessibility_need: "none" }]);
    });

    it("rejects a second profile for the same person with 23505", async () => {
      const person = await service.save({ name: "Maria" });
      const repository = dataSource.getRepository(StudentProfile);
      const newProfile = () =>
        repository.save(repository.create({ personId: person.id, createdById: person.id }));

      await newProfile();

      await expect(newProfile()).rejects.toMatchObject({
        code: "23505",
        constraint: "uq_student_profiles_person_id",
      });
    });

    it("round-trips every StudentProfile and Person field, with birthDate as YYYY-MM-DD", async () => {
      const actor = await service.save({ name: "Coordinator" });
      const person = await service.save({
        name: "Maria Silva Santos",
        email: "maria.santos@example.com",
        birthDate: "1958-04-12",
        phone: "43999990000",
      });
      const archivedAt = new Date("2026-09-15T10:00:00.000Z");

      const repository = dataSource.getRepository(StudentProfile);
      await repository.save(
        repository.create({
          personId: person.id,
          education: "Ensino fundamental completo",
          hasSmartphone: true,
          hasComputer: false,
          howFoundUs: "Indicação de uma amiga",
          emergencyContactName: "Ana Santos",
          emergencyContactPhone: "43988887777",
          accessibilityNeed: AccessibilityNeed.COGNITIVE,
          supportResource: "Fonte ampliada",
          classNeeds: "Sentar perto do projetor",
          createdById: actor.id,
          archive: { archivedAt, archivedById: actor.id, archiveReason: "Mudou de cidade." },
        }),
      );

      const loadedPerson = await dataSource
        .getRepository(Person)
        .findOneByOrFail({ id: person.id });
      expect(loadedPerson.birthDate).toBe("1958-04-12");
      expect(loadedPerson.phone).toBe("43999990000");

      const loaded = await repository.findOneByOrFail({ personId: person.id });
      expect(loaded).toMatchObject({
        personId: person.id,
        education: "Ensino fundamental completo",
        hasSmartphone: true,
        hasComputer: false,
        howFoundUs: "Indicação de uma amiga",
        emergencyContactName: "Ana Santos",
        emergencyContactPhone: "43988887777",
        accessibilityNeed: AccessibilityNeed.COGNITIVE,
        supportResource: "Fonte ampliada",
        classNeeds: "Sentar perto do projetor",
        createdById: actor.id,
        deletedAt: null,
      });
      expect(loaded.archive.archivedAt).toEqual(archivedAt);
      expect(loaded.archive.archivedById).toBe(actor.id);
      expect(loaded.archive.archiveReason).toBe("Mudou de cidade.");

      // The column is a plain date: no time, no time zone.
      const rows: Array<{ birth_date: string }> = await dataSource.query(
        `SELECT birth_date::text AS birth_date FROM people WHERE id = $1`,
        [person.id],
      );
      expect(rows).toEqual([{ birth_date: "1958-04-12" }]);
    });

    it("keeps the archive columns null for an active student", async () => {
      const person = await service.save({ name: "Maria" });
      const repository = dataSource.getRepository(StudentProfile);
      await repository.save(repository.create({ personId: person.id, createdById: person.id }));

      const loaded = await repository.findOneByOrFail({ personId: person.id });

      expect(loaded.archive).toMatchObject({
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
      });
      expect(loaded.accessibilityNeed).toBe(AccessibilityNeed.NONE);
    });
  });

  describe("StudentsService.findByIds", () => {
    const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";

    async function registerStudent(actorId: string, name: string) {
      return studentsService.create({ name, birthDate: "1958-04-12" }, actorId);
    }

    it("returns the students of the given ids and ignores unknown ids", async () => {
      const actor = await service.save({ name: "Coordinator" });
      const maria = await registerStudent(actor.id, "Maria Silva Santos");
      const jose = await registerStudent(actor.id, "José Souza");

      const found = await studentsService.findByIds([maria.id, UNKNOWN_ID, jose.id, maria.id]);

      expect(found.map((student) => student.id).sort()).toEqual([maria.id, jose.id].sort());
      expect(found.find((student) => student.id === maria.id)?.name).toBe("Maria Silva Santos");
      // The actor is a Person without a student profile: not a student.
      expect(await studentsService.findByIds([actor.id])).toEqual([]);
      expect(await studentsService.findByIds([])).toEqual([]);
    });

    it("skips archived students when excludeArchived is true and keeps them by default", async () => {
      const actor = await service.save({ name: "Coordinator" });
      const maria = await registerStudent(actor.id, "Maria Silva Santos");
      const jose = await registerStudent(actor.id, "José Souza");
      await studentsService.archive(jose.id, { reason: "Mudou de cidade." }, actor.id);

      const byDefault = await studentsService.findByIds([maria.id, jose.id]);
      const onlyActive = await studentsService.findByIds([maria.id, jose.id], {
        excludeArchived: true,
      });

      expect(byDefault.map((student) => student.id).sort()).toEqual([maria.id, jose.id].sort());
      expect(byDefault.find((student) => student.id === jose.id)?.archivedAt).not.toBeNull();
      expect(onlyActive.map((student) => student.id)).toEqual([maria.id]);
    });
  });
});
