import "reflect-metadata";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { join } from "node:path";
import { DataSource } from "typeorm";
import { Role } from "@shared/enums/role.enum";
import { PeopleModule } from "../people.module";
import { MembersService } from "../services/members.service";
import { PeopleService } from "../services/people.service";
import { insertDepartment, insertMemberProfile } from "./fixtures/member-registration.fixture";

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

const UNKNOWN_ID = "01999a3e-0000-7000-8000-000000000000";

describe("MembersService.findMemberRefs (e2e)", () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let peopleService: PeopleService;
  let membersService: MembersService;

  let tech: string;
  let comms: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        EventEmitterModule.forRoot(),
        TypeOrmModule.forRoot({
          type: "postgres",
          ...dbConnection,
          ssl: dbUrl ? { rejectUnauthorized: false } : false,
          entities: [join(__dirname, "..", "..", "..", "**", "*.entity.{ts,js}")],
          synchronize: false,
          migrationsRun: false,
        }),
        PeopleModule,
      ],
    }).compile();

    dataSource = module.get(DataSource);
    peopleService = module.get(PeopleService);
    membersService = module.get(MembersService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await dataSource.query(
      `TRUNCATE TABLE member_profiles, invites, departments, people RESTART IDENTITY CASCADE`,
    );
    tech = await insertDepartment(dataSource, "Tecnologia");
    comms = await insertDepartment(dataSource, "Comunicação");
  });

  /** A person with an access role and, when `status` comes, a member profile in `departmentId`. */
  async function createPerson(
    name: string,
    options: {
      role?: Role;
      ra?: string;
      status?: "pending" | "approved" | "rejected";
      departmentId?: string | null;
    } = {},
  ): Promise<string> {
    const person = await peopleService.save({
      name,
      ra: options.ra,
      role: options.role ?? null,
      accessEnabled: options.role !== undefined,
    });
    if (options.status !== undefined) {
      await insertMemberProfile(dataSource, {
        personId: person.id,
        status: options.status,
        departmentId: options.departmentId ?? null,
      });
    }
    return person.id;
  }

  it("answers id, name and the department of the approved profile, ordered by name and id", async () => {
    const carla = await createPerson("Carla Dias", { role: Role.COORDINATOR });
    const ana = await createPerson("Ana Souza", {
      role: Role.MEMBER,
      status: "approved",
      departmentId: tech,
    });
    const bruno = await createPerson("Bruno Lima", {
      role: Role.MEMBER,
      status: "approved",
      departmentId: null,
    });

    const refs = await membersService.findMemberRefs({ ids: [carla, bruno, ana] });

    expect(refs).toEqual([
      { id: ana, name: "Ana Souza", department: { id: tech, name: "Tecnologia" } },
      { id: bruno, name: "Bruno Lima", department: null },
      { id: carla, name: "Carla Dias", department: null },
    ]);
  });

  it("filters by ids, leaving out unknown ids, students and deleted people", async () => {
    const ana = await createPerson("Ana Souza", {
      role: Role.MEMBER,
      status: "approved",
      departmentId: tech,
    });
    const student = await createPerson("Bruno Lima");
    const deleted = await createPerson("Carla Dias", {
      role: Role.MEMBER,
      status: "approved",
      departmentId: tech,
    });
    await dataSource.query(`UPDATE people SET deleted_at = now() WHERE id = $1`, [deleted]);

    const refs = await membersService.findMemberRefs({
      ids: [ana, student, deleted, UNKNOWN_ID, ana.toUpperCase()],
    });

    expect(refs.map((ref) => ref.id)).toEqual([ana]);
  });

  it("filters by department through the approved profile only: a pending or rejected profile of the department is left out", async () => {
    const approvedTech = await createPerson("Ana Souza", {
      role: Role.MEMBER,
      status: "approved",
      departmentId: tech,
    });
    const pendingTech = await createPerson("Bruno Lima", { status: "pending", departmentId: tech });
    const rejectedTech = await createPerson("Carla Dias", {
      status: "rejected",
      departmentId: tech,
    });
    const approvedComms = await createPerson("Daniel Rocha", {
      role: Role.DIRECTOR,
      status: "approved",
      departmentId: comms,
    });

    expect(await membersService.findMemberRefs({ departmentIds: [tech] })).toEqual([
      { id: approvedTech, name: "Ana Souza", department: { id: tech, name: "Tecnologia" } },
    ]);
    expect(
      (await membersService.findMemberRefs({ departmentIds: [tech, comms] })).map((ref) => ref.id),
    ).toEqual([approvedTech, approvedComms]);

    const byIds = await membersService.findMemberRefs({ ids: [pendingTech, rejectedTech] });
    expect(byIds).toEqual([
      { id: pendingTech, name: "Bruno Lima", department: null },
      { id: rejectedTech, name: "Carla Dias", department: null },
    ]);
  });

  it("searches the name or the RA ignoring case and accents", async () => {
    const ana = await createPerson("Ana Sôuza", {
      role: Role.MEMBER,
      ra: "a2210001",
      status: "approved",
      departmentId: tech,
    });
    const bruno = await createPerson("Bruno Lima", {
      role: Role.MEMBER,
      ra: "a2210002",
      status: "approved",
      departmentId: comms,
    });

    expect((await membersService.findMemberRefs({ search: "ANA" })).map((ref) => ref.id)).toEqual([
      ana,
    ]);
    expect((await membersService.findMemberRefs({ search: "SOUZA" })).map((ref) => ref.id)).toEqual(
      [ana],
    );
    expect((await membersService.findMemberRefs({ search: "0002" })).map((ref) => ref.id)).toEqual([
      bruno,
    ]);
    expect(
      (await membersService.findMemberRefs({ search: "a22100" })).map((ref) => ref.id),
    ).toEqual([ana, bruno]);
  });

  it("includes coordination without member profile, with department null, and combines the filters", async () => {
    const carla = await createPerson("Carla Dias", { role: Role.COORDINATOR, ra: "c0001" });
    const ana = await createPerson("Ana Dias", {
      role: Role.MEMBER,
      status: "approved",
      departmentId: tech,
    });
    await createPerson("Bruno Dias", {
      role: Role.MEMBER,
      status: "approved",
      departmentId: comms,
    });

    expect(await membersService.findMemberRefs({ search: "Carla" })).toEqual([
      { id: carla, name: "Carla Dias", department: null },
    ]);
    expect(
      (await membersService.findMemberRefs({ departmentIds: [tech], search: "dias" })).map(
        (ref) => ref.id,
      ),
    ).toEqual([ana]);
    expect(
      (await membersService.findMemberRefs({ ids: [carla, ana], search: "dias" })).map(
        (ref) => ref.id,
      ),
    ).toEqual([ana, carla]);
  });

  it("gives the same department as findAccessFacts (departmentScopeOf) for an approved, a pending, a rejected and no member profile", async () => {
    const approved = await createPerson("Ana Souza", {
      role: Role.MEMBER,
      status: "approved",
      departmentId: tech,
    });
    const approvedWithoutDepartment = await createPerson("Bruno Lima", {
      role: Role.MEMBER,
      status: "approved",
      departmentId: null,
    });
    const pending = await createPerson("Carla Dias", { status: "pending", departmentId: tech });
    const rejected = await createPerson("Daniel Rocha", {
      status: "rejected",
      departmentId: comms,
    });
    const withoutProfile = await createPerson("Elisa Prado", { role: Role.COORDINATOR });
    const ids = [approved, approvedWithoutDepartment, pending, rejected, withoutProfile];

    const refs = await membersService.findMemberRefs({ ids });

    expect(refs.map((ref) => ref.id)).toEqual(ids);
    const fromSql = refs.map((ref) => (ref.department === null ? [] : [ref.department.id]));
    const fromTypeScript = [];
    for (const id of ids) {
      fromTypeScript.push((await membersService.findAccessFacts(id)).departmentIds);
    }
    expect(fromSql).toEqual(fromTypeScript);
    expect(fromSql).toEqual([[tech], [], [], [], []]);
  });
});
